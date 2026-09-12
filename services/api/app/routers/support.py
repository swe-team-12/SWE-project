import asyncio
import json
import secrets
import uuid
from datetime import datetime

import jwt
from fastapi import APIRouter, File, UploadFile, WebSocket, WebSocketDisconnect
from sqlalchemy import or_, select

from app.access import (
    get_event_or_404,
    require_event_permission,
    require_event_view_access,
    require_support_access,
)
from app.db import SessionLocal
from app.deps import CurrentUser, DbSession
from app.enums import NotificationType, StaffRole, SupportKind, UserRole
from app.errors import AppError
from app.models import (
    Event,
    Order,
    OrderItem,
    StaffAssignment,
    SupportAttachment,
    SupportCase,
    SupportMessage,
    Ticket,
    User,
)
from app.realtime import publish, redis_client, support_channel
from app.schemas import SupportCaseCreate, SupportMessageCreate, SupportStatusUpdate
from app.security import decode_access_token
from app.services import create_notification, put_private_object, record_audit, signed_download_url

router = APIRouter(prefix="/support", tags=["support"])

ALLOWED_ATTACHMENTS = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "application/pdf": (b"%PDF-",),
}
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024


async def validated_case_context(
    db: DbSession, payload: SupportCaseCreate, user: User
) -> tuple[uuid.UUID | None, uuid.UUID | None, uuid.UUID | None]:
    """Resolve contextual IDs and prove that they belong to the requester and each other."""
    event = await get_event_or_404(db, payload.event_id) if payload.event_id else None
    order = await db.get(Order, payload.order_id) if payload.order_id else None
    if payload.order_id and order is None:
        raise AppError(404, "order_not_found", "Order not found", "The order is unavailable.")
    ticket = await db.get(Ticket, payload.ticket_id) if payload.ticket_id else None
    if payload.ticket_id and ticket is None:
        raise AppError(404, "ticket_not_found", "Ticket not found", "The ticket is unavailable.")

    ticket_order: Order | None = None
    if ticket is not None:
        item = await db.get(OrderItem, ticket.order_item_id)
        ticket_order = await db.get(Order, item.order_id) if item else None
        if ticket_order is None:
            raise AppError(409, "ticket_context_invalid", "Invalid context", "Ticket context is incomplete.")

    resolved_event_id = (
        event.id
        if event
        else order.event_id
        if order
        else ticket.event_id
        if ticket
        else None
    )
    related_event_ids = {
        item
        for item in (
            event.id if event else None,
            order.event_id if order else None,
            ticket.event_id if ticket else None,
        )
        if item is not None
    }
    if len(related_event_ids) > 1 or (
        order is not None and ticket_order is not None and order.id != ticket_order.id
    ):
        raise AppError(
            422,
            "support_context_mismatch",
            "Context does not match",
            "The selected event, order, and ticket must belong together.",
        )

    if payload.kind == SupportKind.ATTENDEE_TO_ORGANIZER:
        if resolved_event_id is None:
            raise AppError(422, "event_context_required", "Event required", "Select the related event.")
        resolved_event = event or await get_event_or_404(db, resolved_event_id)
        await require_event_view_access(db, resolved_event, user)
        if order is not None and order.user_id != user.id:
            raise AppError(403, "order_context_denied", "Permission denied", "This is not your order.")
        if ticket is not None and ticket.owner_user_id != user.id:
            raise AppError(403, "ticket_context_denied", "Permission denied", "This is not your ticket.")
    elif resolved_event_id is not None:
        resolved_event = event or await get_event_or_404(db, resolved_event_id)
        await require_event_permission(db, resolved_event, user)

    return resolved_event_id, order.id if order else None, ticket.id if ticket else None


async def notify_case_participants(
    db: DbSession, case: SupportCase, sender: User, body: str
) -> None:
    recipients: set[uuid.UUID] = {case.requester_id}
    if case.assignee_id:
        recipients.add(case.assignee_id)
    if case.event_id:
        event = await db.get(Event, case.event_id)
        if event:
            recipients.add(event.owner_id)
        assigned = await db.scalars(
            select(StaffAssignment.user_id).where(
                StaffAssignment.event_id == case.event_id,
                StaffAssignment.role.in_([StaffRole.SUPPORT, StaffRole.MANAGER]),
            )
        )
        recipients.update(assigned.all())
    recipients.discard(sender.id)
    for user_id in recipients:
        await create_notification(
            db,
            user_id=user_id,
            type=NotificationType.SUPPORT_MESSAGE,
            title=f"New message in {case.case_number}",
            body=body[:180],
            data={"case_id": str(case.id)},
        )


def serialize_case(case: SupportCase) -> dict:
    return {
        "id": str(case.id),
        "case_number": case.case_number,
        "kind": case.kind,
        "category": case.category,
        "status": case.status,
        "subject": case.subject,
        "requester_id": str(case.requester_id),
        "assignee_id": str(case.assignee_id) if case.assignee_id else None,
        "event_id": str(case.event_id) if case.event_id else None,
        "order_id": str(case.order_id) if case.order_id else None,
        "ticket_id": str(case.ticket_id) if case.ticket_id else None,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
    }


@router.post("/cases", status_code=201)
async def create_case(payload: SupportCaseCreate, user: CurrentUser, db: DbSession) -> dict:
    if (
        payload.kind == SupportKind.ORGANIZER_TO_PLATFORM
        and UserRole.ORGANIZER.value not in user.roles
    ):
        raise AppError(
            403,
            "organizer_required",
            "Permission denied",
            "Only organizers can use this case type.",
        )
    event_id, order_id, ticket_id = await validated_case_context(db, payload, user)
    case = SupportCase(
        case_number=f"SUP-{datetime.now():%y%m%d}-{secrets.token_hex(3).upper()}",
        kind=payload.kind,
        category=payload.category,
        requester_id=user.id,
        event_id=event_id,
        order_id=order_id,
        ticket_id=ticket_id,
        subject=payload.subject,
    )
    db.add(case)
    await db.flush()
    message = SupportMessage(case_id=case.id, sender_id=user.id, body=payload.message)
    db.add(message)
    await notify_case_participants(db, case, user, payload.message)
    await record_audit(
        db,
        action="support.case_created",
        entity_type="support_case",
        entity_id=case.id,
        event_id=case.event_id,
        actor_user_id=user.id,
        description=f"Opened support case {case.case_number}.",
    )
    await db.commit()
    await publish(support_channel(case.id), {"type": "case.created", "case": serialize_case(case)})
    return serialize_case(case)


@router.get("/cases")
async def list_cases(user: CurrentUser, db: DbSession) -> list[dict]:
    if UserRole.PLATFORM_ADMIN.value in user.roles:
        statement = select(SupportCase)
    else:
        owned_events = select(Event.id).where(Event.owner_id == user.id)
        assigned_events = select(StaffAssignment.event_id).where(
            StaffAssignment.user_id == user.id,
            StaffAssignment.role.in_([StaffRole.SUPPORT, StaffRole.MANAGER]),
        )
        statement = select(SupportCase).where(
            or_(
                SupportCase.requester_id == user.id,
                SupportCase.assignee_id == user.id,
                SupportCase.event_id.in_(owned_events),
                SupportCase.event_id.in_(assigned_events),
            )
        )
    cases = (await db.scalars(statement.order_by(SupportCase.updated_at.desc()).limit(100))).all()
    return [serialize_case(case) for case in cases]


@router.get("/cases/{case_id}")
async def case_detail(case_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    case = await db.get(SupportCase, case_id)
    if case is None:
        raise AppError(404, "case_not_found", "Case not found", "The support case does not exist.")
    await require_support_access(db, case, user)
    messages = (
        await db.scalars(
            select(SupportMessage)
            .where(SupportMessage.case_id == case.id)
            .order_by(SupportMessage.created_at)
        )
    ).all()
    attachments: list[SupportAttachment] = []
    if messages:
        attachments = list(
            (
                await db.scalars(
                    select(SupportAttachment).where(
                        SupportAttachment.message_id.in_([message.id for message in messages])
                    )
                )
            ).all()
        )
    attachments_by_message: dict[uuid.UUID, list[SupportAttachment]] = {}
    for attachment in attachments:
        attachments_by_message.setdefault(attachment.message_id, []).append(attachment)
    return {
        **serialize_case(case),
        "messages": [
            {
                "id": str(message.id),
                "sender_id": str(message.sender_id),
                "body": message.body,
                "created_at": message.created_at,
                "attachments": [
                    {
                        "id": str(attachment.id),
                        "name": attachment.original_name,
                        "mime_type": attachment.mime_type,
                        "size_bytes": attachment.size_bytes,
                    }
                    for attachment in attachments_by_message.get(message.id, [])
                ],
            }
            for message in messages
        ],
    }


@router.post("/cases/{case_id}/messages", status_code=201)
async def add_message(
    case_id: uuid.UUID, payload: SupportMessageCreate, user: CurrentUser, db: DbSession
) -> dict:
    case = await db.get(SupportCase, case_id)
    if case is None:
        raise AppError(404, "case_not_found", "Case not found", "The support case does not exist.")
    await require_support_access(db, case, user)
    message = SupportMessage(case_id=case.id, sender_id=user.id, body=payload.body)
    db.add(message)
    await notify_case_participants(db, case, user, payload.body)
    await db.commit()
    message_payload = {
        "id": str(message.id),
        "sender_id": str(user.id),
        "body": message.body,
        "created_at": message.created_at.isoformat(),
    }
    event = {
        "type": "message.created",
        "message": message_payload,
    }
    await publish(support_channel(case.id), event)
    return message_payload


@router.patch("/cases/{case_id}")
async def update_case(
    case_id: uuid.UUID, payload: SupportStatusUpdate, user: CurrentUser, db: DbSession
) -> dict:
    case = await db.get(SupportCase, case_id)
    if case is None:
        raise AppError(404, "case_not_found", "Case not found", "The support case does not exist.")
    await require_support_access(db, case, user)
    if case.requester_id == user.id and UserRole.PLATFORM_ADMIN.value not in user.roles:
        raise AppError(403, "staff_required", "Permission denied", "Staff must update case status.")
    if payload.assignee_id:
        assignee = await db.get(User, payload.assignee_id)
        authorized_assignee = bool(
            assignee and UserRole.PLATFORM_ADMIN.value in assignee.roles
        )
        if assignee and case.kind == SupportKind.ATTENDEE_TO_ORGANIZER and case.event_id:
            event = await db.get(Event, case.event_id)
            assignment = await db.scalar(
                select(StaffAssignment.id).where(
                    StaffAssignment.event_id == case.event_id,
                    StaffAssignment.user_id == assignee.id,
                    StaffAssignment.role.in_([StaffRole.SUPPORT, StaffRole.MANAGER]),
                )
            )
            authorized_assignee = authorized_assignee or bool(
                event and event.owner_id == assignee.id
            ) or bool(assignment)
        if not authorized_assignee:
            raise AppError(
                422,
                "assignee_not_authorized",
                "Invalid assignee",
                "Assign this case to authorized support staff.",
            )
    old_status = case.status
    case.status = payload.status
    case.assignee_id = payload.assignee_id or case.assignee_id or user.id
    await create_notification(
        db,
        user_id=case.requester_id,
        type=NotificationType.SUPPORT_STATUS,
        title=f"Support case {case.case_number} updated",
        body=f"Status changed from {old_status.value} to {case.status.value}.",
        data={"case_id": str(case.id)},
    )
    await record_audit(
        db,
        action="support.status_changed",
        entity_type="support_case",
        entity_id=case.id,
        event_id=case.event_id,
        actor_user_id=user.id,
        description=f"Changed support status to {case.status.value}.",
    )
    await db.commit()
    event_message = {"type": "case.updated", "case": serialize_case(case)}
    await publish(support_channel(case.id), event_message)
    return serialize_case(case)


@router.post("/messages/{message_id}/attachments", status_code=201)
async def upload_attachment(
    message_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> dict:
    message = await db.get(SupportMessage, message_id)
    if message is None:
        raise AppError(404, "message_not_found", "Message not found", "The message does not exist.")
    case = await db.get(SupportCase, message.case_id)
    assert case is not None
    await require_support_access(db, case, user)
    if message.sender_id != user.id:
        raise AppError(
            403,
            "attachment_message_denied",
            "Permission denied",
            "Attachments may only be added to your own message.",
        )
    content = await file.read(MAX_ATTACHMENT_SIZE + 1)
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise AppError(413, "attachment_too_large", "File too large", "The maximum size is 10 MB.")
    media_type = file.content_type or "application/octet-stream"
    signatures = ALLOWED_ATTACHMENTS.get(media_type)
    if not signatures or not any(content.startswith(signature) for signature in signatures):
        raise AppError(
            415, "attachment_type_invalid", "Unsupported file", "Upload JPEG, PNG, or PDF."
        )
    suffix = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}[media_type]
    key = f"support/{case.id}/{secrets.token_hex(16)}.{suffix}"
    put_private_object(key, content, media_type)
    attachment = SupportAttachment(
        message_id=message.id,
        object_key=key,
        original_name=(file.filename or f"attachment.{suffix}")[:255],
        mime_type=media_type,
        size_bytes=len(content),
    )
    db.add(attachment)
    await db.commit()
    result = {
        "id": str(attachment.id),
        "name": attachment.original_name,
        "mime_type": attachment.mime_type,
        "size_bytes": attachment.size_bytes,
    }
    await publish(support_channel(case.id), {"type": "attachment.created", "attachment": result})
    return result


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    attachment = await db.get(SupportAttachment, attachment_id)
    if attachment is None:
        raise AppError(
            404, "attachment_not_found", "File not found", "The attachment does not exist."
        )
    message = await db.get(SupportMessage, attachment.message_id)
    assert message is not None
    case = await db.get(SupportCase, message.case_id)
    assert case is not None
    await require_support_access(db, case, user)
    return {"url": signed_download_url(attachment.object_key), "expires_in": 300}


@router.websocket("/cases/{case_id}/ws")
async def support_socket(websocket: WebSocket, case_id: uuid.UUID, token: str) -> None:
    async with SessionLocal() as db:
        try:
            payload = decode_access_token(token)
            user = await db.get(User, uuid.UUID(payload["sub"]))
            case = await db.get(SupportCase, case_id)
            if user is None or case is None:
                raise ValueError
            await require_support_access(db, case, user)
        except (ValueError, KeyError, jwt.InvalidTokenError, AppError):
            await websocket.close(code=4403)
            return
    await websocket.accept()
    client = redis_client()
    pubsub = client.pubsub()
    await pubsub.subscribe(support_channel(case_id))
    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message:
                await websocket.send_text(message["data"])
            try:
                incoming = await asyncio.wait_for(websocket.receive_text(), timeout=0.1)
                if incoming == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except TimeoutError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(support_channel(case_id))
        await pubsub.aclose()
        await client.aclose()
