import asyncio
import json
import secrets
import uuid
from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, File, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import or_, select

from app.access import (
    get_event_or_404,
    is_platform_admin,
    platform_admins,
    require_event_permission,
    require_event_view_access,
    require_support_access,
)
from app.db import SessionLocal
from app.deps import CurrentUser, DbSession
from app.enums import NotificationType, StaffRole, SupportKind, SupportStatus, UserRole
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


async def has_purchase_for_event(db: DbSession, event_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    order_id = await db.scalar(
        select(Order.id).where(Order.event_id == event_id, Order.user_id == user_id).limit(1)
    )
    if order_id:
        return True
    ticket_id = await db.scalar(
        select(Ticket.id)
        .where(Ticket.event_id == event_id, Ticket.owner_user_id == user_id)
        .limit(1)
    )
    return bool(ticket_id)


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
        if order is not None and order.user_id != user.id:
            raise AppError(403, "order_context_denied", "Permission denied", "This is not your order.")
        if ticket is not None and ticket.owner_user_id != user.id:
            raise AppError(403, "ticket_context_denied", "Permission denied", "This is not your ticket.")
        # A buyer may always ask about an event they hold an order or ticket for, even
        # when it is past, cancelled, unpublished, suspended or private. Everyone else
        # needs ordinary view access.
        if not await has_purchase_for_event(db, resolved_event.id, user.id):
            await require_event_view_access(db, resolved_event, user)
    elif resolved_event_id is not None:
        resolved_event = event or await get_event_or_404(db, resolved_event_id)
        await require_event_permission(db, resolved_event, user)

    linked_order = order or ticket_order
    return (
        resolved_event_id,
        linked_order.id if linked_order else None,
        ticket.id if ticket else None,
    )


async def case_team_ids(db: DbSession, case: SupportCase) -> set[uuid.UUID]:
    """Event owner plus support and manager staff of the case's event."""
    team: set[uuid.UUID] = set()
    if case.event_id:
        event = await db.get(Event, case.event_id)
        if event:
            team.add(event.owner_id)
        assigned = await db.scalars(
            select(StaffAssignment.user_id).where(
                StaffAssignment.event_id == case.event_id,
                StaffAssignment.role.in_([StaffRole.SUPPORT, StaffRole.MANAGER]),
            )
        )
        team.update(assigned.all())
    return team


def involves_platform(case: SupportCase) -> bool:
    return case.kind == SupportKind.ORGANIZER_TO_PLATFORM or bool(case.escalated)


def case_notification_data(case: SupportCase, **extra: object) -> dict[str, object]:
    data: dict[str, object] = {
        "case_id": str(case.id),
        "case_number": case.case_number,
        "kind": case.kind.value,
        "escalated": bool(case.escalated),
        "event_id": str(case.event_id) if case.event_id else None,
    }
    data.update(extra)
    return data


async def notify_case_participants(
    db: DbSession, case: SupportCase, sender: User, body: str, *, created: bool = False
) -> None:
    recipients: set[uuid.UUID] = {case.requester_id}
    if case.assignee_id:
        recipients.add(case.assignee_id)
    recipients.update(await case_team_ids(db, case))
    if involves_platform(case):
        recipients.update(admin.id for admin in await platform_admins(db))
    recipients.discard(sender.id)
    for user_id in recipients:
        await create_notification(
            db,
            user_id=user_id,
            type=NotificationType.SUPPORT_MESSAGE,
            title=(
                f"New support case {case.case_number}"
                if created
                else f"New message in {case.case_number}"
            ),
            body=body[:180],
            data=case_notification_data(
                case, change="case_created" if created else "message_created"
            ),
        )


def message_sender_role(case: SupportCase, sender: User | None, sender_id: uuid.UUID) -> str:
    if sender_id == case.requester_id:
        return "requester"
    if is_platform_admin(sender):
        return "platform_admin"
    return "staff"


def serialize_message(
    case: SupportCase,
    message: SupportMessage,
    sender: User | None,
    attachments: list[SupportAttachment] | None = None,
) -> dict:
    role = message_sender_role(case, sender, message.sender_id)
    return {
        "id": str(message.id),
        "sender_id": str(message.sender_id),
        "sender_name": sender.display_name if sender else None,
        "sender_role": role,
        "sender_is_staff": role != "requester",
        "body": message.body,
        "created_at": message.created_at,
        "attachments": [
            {
                "id": str(attachment.id),
                "name": attachment.original_name,
                "mime_type": attachment.mime_type,
                "size_bytes": attachment.size_bytes,
            }
            for attachment in attachments or []
        ],
    }


def serialize_case(
    case: SupportCase,
    users: dict[uuid.UUID, User] | None = None,
    events: dict[uuid.UUID, Event] | None = None,
    orders: dict[uuid.UUID, Order] | None = None,
    tickets: dict[uuid.UUID, Ticket] | None = None,
) -> dict:
    users, events, orders, tickets = users or {}, events or {}, orders or {}, tickets or {}
    requester = users.get(case.requester_id)
    assignee = users.get(case.assignee_id) if case.assignee_id else None
    event = events.get(case.event_id) if case.event_id else None
    order = orders.get(case.order_id) if case.order_id else None
    ticket = tickets.get(case.ticket_id) if case.ticket_id else None
    return {
        "id": str(case.id),
        "case_number": case.case_number,
        "kind": case.kind,
        "category": case.category,
        "status": case.status,
        "subject": case.subject,
        "requester_id": str(case.requester_id),
        "requester_name": requester.display_name if requester else None,
        "requester_email": requester.email if requester else None,
        "assignee_id": str(case.assignee_id) if case.assignee_id else None,
        "assignee_name": assignee.display_name if assignee else None,
        "assignee": (
            {
                "id": str(assignee.id),
                "display_name": assignee.display_name,
                "email": assignee.email,
            }
            if assignee
            else None
        ),
        "escalated": bool(case.escalated),
        "escalated_at": case.escalated_at,
        "escalated_by_id": str(case.escalated_by_id) if case.escalated_by_id else None,
        "event_id": str(case.event_id) if case.event_id else None,
        "order_id": str(case.order_id) if case.order_id else None,
        "ticket_id": str(case.ticket_id) if case.ticket_id else None,
        "context": {
            "event": (
                {"id": str(case.event_id), "title": event.title if event else None}
                if case.event_id
                else None
            ),
            "order": (
                {"id": str(case.order_id), "number": order.order_number if order else None}
                if case.order_id
                else None
            ),
            "ticket": (
                {"id": str(case.ticket_id), "code": ticket.ticket_code if ticket else None}
                if case.ticket_id
                else None
            ),
        },
        "created_at": case.created_at,
        "updated_at": case.updated_at,
    }


async def serialize_cases(db: DbSession, cases: list[SupportCase]) -> list[dict]:
    """Serialize cases with names and context labels using one query per related table."""
    user_ids = {case.requester_id for case in cases} | {
        case.assignee_id for case in cases if case.assignee_id
    }
    event_ids = {case.event_id for case in cases if case.event_id}
    order_ids = {case.order_id for case in cases if case.order_id}
    ticket_ids = {case.ticket_id for case in cases if case.ticket_id}
    users: dict[uuid.UUID, User] = {}
    events: dict[uuid.UUID, Event] = {}
    orders: dict[uuid.UUID, Order] = {}
    tickets: dict[uuid.UUID, Ticket] = {}
    if user_ids:
        users = {
            item.id: item
            for item in (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()
        }
    if event_ids:
        events = {
            item.id: item
            for item in (await db.scalars(select(Event).where(Event.id.in_(event_ids)))).all()
        }
    if order_ids:
        orders = {
            item.id: item
            for item in (await db.scalars(select(Order).where(Order.id.in_(order_ids)))).all()
        }
    if ticket_ids:
        tickets = {
            item.id: item
            for item in (await db.scalars(select(Ticket).where(Ticket.id.in_(ticket_ids)))).all()
        }
    return [serialize_case(case, users, events, orders, tickets) for case in cases]


async def serialize_one(db: DbSession, case: SupportCase) -> dict:
    return (await serialize_cases(db, [case]))[0]


async def assignable_users(
    db: DbSession, case: SupportCase, *, include_admins: bool
) -> list[dict]:
    """People a case may be assigned to, with the reason they qualify."""
    result: dict[uuid.UUID, dict] = {}

    def add(person: User, role: str) -> None:
        entry = result.setdefault(
            person.id,
            {
                "id": str(person.id),
                "display_name": person.display_name,
                "email": person.email,
                "roles": [],
            },
        )
        if role not in entry["roles"]:
            entry["roles"].append(role)

    if case.kind == SupportKind.ATTENDEE_TO_ORGANIZER and case.event_id:
        event = await db.get(Event, case.event_id)
        if event:
            owner = await db.get(User, event.owner_id)
            if owner:
                add(owner, "owner")
        rows = (
            await db.execute(
                select(StaffAssignment.role, User)
                .join(User, User.id == StaffAssignment.user_id)
                .where(
                    StaffAssignment.event_id == case.event_id,
                    StaffAssignment.role.in_([StaffRole.SUPPORT, StaffRole.MANAGER]),
                )
                .order_by(User.display_name)
            )
        ).all()
        for role, person in rows:
            add(person, role.value)
    if include_admins:
        for person in await platform_admins(db):
            add(person, "platform_admin")
    return list(result.values())


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
    await notify_case_participants(db, case, user, payload.message, created=True)
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
    result = await serialize_one(db, case)
    await publish(support_channel(case.id), {"type": "case.created", "case": result})
    return result


@router.get("/contexts")
async def case_contexts(user: CurrentUser, db: DbSession) -> dict:
    """Events, orders and tickets the signed-in user may attach to a new support case."""
    orders = (
        await db.scalars(
            select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(200)
        )
    ).all()
    ticket_rows = (
        await db.execute(
            select(Ticket, OrderItem)
            .join(OrderItem, OrderItem.id == Ticket.order_item_id)
            .where(Ticket.owner_user_id == user.id)
            .order_by(Ticket.created_at.desc())
            .limit(500)
        )
    ).all()
    owned = select(Event.id).where(Event.owner_id == user.id)
    staffed = select(StaffAssignment.event_id).where(StaffAssignment.user_id == user.id)
    managed = (
        await db.scalars(
            select(Event)
            .where(or_(Event.id.in_(owned), Event.id.in_(staffed)))
            .order_by(Event.starts_at.desc())
            .limit(200)
        )
    ).all()
    purchased_ids = {order.event_id for order in orders} | {
        ticket.event_id for ticket, _ in ticket_rows
    }
    purchased: dict[uuid.UUID, Event] = {}
    if purchased_ids:
        purchased = {
            item.id: item
            for item in (await db.scalars(select(Event).where(Event.id.in_(purchased_ids)))).all()
        }

    def event_row(event: Event) -> dict:
        return {
            "id": str(event.id),
            "title": event.title,
            "status": event.status,
            "visibility": event.visibility,
            "starts_at": event.starts_at,
            "ends_at": event.ends_at,
        }

    return {
        "events": [
            event_row(event)
            for event in sorted(purchased.values(), key=lambda item: item.starts_at, reverse=True)
        ],
        "orders": [
            {
                "id": str(order.id),
                "order_number": order.order_number,
                "status": order.status,
                "total_tiyin": order.total_tiyin,
                "event_id": str(order.event_id),
                "event_title": (
                    purchased[order.event_id].title if order.event_id in purchased else None
                ),
                "created_at": order.created_at,
            }
            for order in orders
        ],
        "tickets": [
            {
                "id": str(ticket.id),
                "ticket_code": ticket.ticket_code,
                "status": ticket.status,
                "attendee_name": item.attendee_name,
                "order_id": str(item.order_id),
                "event_id": str(ticket.event_id),
                "event_title": (
                    purchased[ticket.event_id].title if ticket.event_id in purchased else None
                ),
            }
            for ticket, item in ticket_rows
        ],
        "managed_events": [event_row(event) for event in managed],
    }


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
    return await serialize_cases(db, list(cases))


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
    sender_ids = {message.sender_id for message in messages}
    senders: dict[uuid.UUID, User] = {}
    if sender_ids:
        senders = {
            item.id: item
            for item in (await db.scalars(select(User).where(User.id.in_(sender_ids)))).all()
        }
    team = await case_team_ids(db, case)
    return {
        **await serialize_one(db, case),
        "viewer": {
            "is_requester": case.requester_id == user.id,
            "is_staff": is_platform_admin(user) or user.id in team,
            "can_update": is_platform_admin(user) or case.requester_id != user.id,
            "can_escalate": (
                case.kind == SupportKind.ATTENDEE_TO_ORGANIZER and not case.escalated
            ),
        },
        "messages": [
            serialize_message(
                case,
                message,
                senders.get(message.sender_id),
                attachments_by_message.get(message.id, []),
            )
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
    case.updated_at = datetime.now(UTC)
    await notify_case_participants(db, case, user, payload.body)
    await db.commit()
    message_payload = serialize_message(case, message, user)
    message_payload["created_at"] = message.created_at.isoformat()
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
    assignee: User | None = None
    if payload.assignee_id:
        allowed = {
            item["id"] for item in await assignable_users(db, case, include_admins=True)
        }
        assignee = await db.get(User, payload.assignee_id)
        if assignee is None or str(assignee.id) not in allowed:
            raise AppError(
                422,
                "assignee_not_authorized",
                "Invalid assignee",
                "Assign this case to authorized support staff.",
            )
    old_status = case.status
    old_assignee_id = case.assignee_id
    case.status = payload.status
    case.assignee_id = payload.assignee_id or case.assignee_id or user.id
    if case.status != old_status:
        await create_notification(
            db,
            user_id=case.requester_id,
            type=NotificationType.SUPPORT_STATUS,
            title=f"Support case {case.case_number} updated",
            body=f"Status changed from {old_status.value} to {case.status.value}.",
            data=case_notification_data(
                case,
                change="status_changed",
                old_status=old_status.value,
                new_status=case.status.value,
            ),
        )
        await record_audit(
            db,
            action="support.status_changed",
            entity_type="support_case",
            entity_id=case.id,
            event_id=case.event_id,
            actor_user_id=user.id,
            description=f"Changed support status to {case.status.value}.",
            data={"old_status": old_status.value, "new_status": case.status.value},
        )
    if case.assignee_id != old_assignee_id:
        await record_audit(
            db,
            action="support.case_assigned",
            entity_type="support_case",
            entity_id=case.id,
            event_id=case.event_id,
            actor_user_id=user.id,
            description=f"Assigned support case {case.case_number}.",
            data={
                "old_assignee_id": str(old_assignee_id) if old_assignee_id else None,
                "new_assignee_id": str(case.assignee_id),
            },
        )
        if case.assignee_id != user.id:
            await create_notification(
                db,
                user_id=case.assignee_id,
                type=NotificationType.SUPPORT_ASSIGNED,
                title=f"Support case {case.case_number} assigned to you",
                body=case.subject[:180],
                data=case_notification_data(
                    case,
                    change="assigned",
                    assigned_by_id=str(user.id),
                    assigned_by_name=user.display_name,
                    subject=case.subject,
                ),
            )
    await db.commit()
    result = await serialize_one(db, case)
    await publish(support_channel(case.id), {"type": "case.updated", "case": result})
    return result


@router.get("/cases/{case_id}/assignees")
async def case_assignees(case_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    case = await db.get(SupportCase, case_id)
    if case is None:
        raise AppError(404, "case_not_found", "Case not found", "The support case does not exist.")
    await require_support_access(db, case, user)
    if case.requester_id == user.id and not is_platform_admin(user):
        raise AppError(403, "staff_required", "Permission denied", "Staff must assign cases.")
    return await assignable_users(
        db, case, include_admins=involves_platform(case) or is_platform_admin(user)
    )


class EscalationRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=2_000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


@router.post("/cases/{case_id}/escalate")
async def escalate_case(
    case_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    payload: EscalationRequest | None = None,
) -> dict:
    case = await db.get(SupportCase, case_id)
    if case is None:
        raise AppError(404, "case_not_found", "Case not found", "The support case does not exist.")
    await require_support_access(db, case, user)
    if case.kind == SupportKind.ORGANIZER_TO_PLATFORM:
        raise AppError(
            409,
            "case_already_with_platform",
            "Already with the platform",
            "This case is already handled by platform support.",
        )
    if case.escalated:
        raise AppError(
            409, "case_already_escalated", "Already escalated", "Platform support was notified."
        )
    reason = payload.reason if payload else None
    now = datetime.now(UTC)
    case.escalated = True
    case.escalated_at = now
    case.escalated_by_id = user.id
    case.updated_at = now
    if case.status == SupportStatus.RESOLVED:
        case.status = SupportStatus.OPEN
    message: SupportMessage | None = None
    if reason:
        message = SupportMessage(
            case_id=case.id, sender_id=user.id, body=f"Escalated to platform support: {reason}"
        )
        db.add(message)
    recipients = {admin.id for admin in await platform_admins(db)}
    recipients.add(case.requester_id)
    recipients.update(await case_team_ids(db, case))
    recipients.discard(user.id)
    for recipient_id in recipients:
        await create_notification(
            db,
            user_id=recipient_id,
            type=NotificationType.SUPPORT_STATUS,
            title=f"Support case {case.case_number} escalated",
            body=(reason or "The case was escalated to platform support.")[:180],
            data=case_notification_data(
                case, change="escalated", reason=reason, escalated_by_id=str(user.id)
            ),
        )
    await record_audit(
        db,
        action="support.case_escalated",
        entity_type="support_case",
        entity_id=case.id,
        event_id=case.event_id,
        actor_user_id=user.id,
        description=f"Escalated support case {case.case_number} to platform support.",
        data={"reason": reason},
    )
    await db.commit()
    result = await serialize_one(db, case)
    await publish(support_channel(case.id), {"type": "case.updated", "case": result})
    if message is not None:
        message_payload = serialize_message(case, message, user)
        message_payload["created_at"] = message.created_at.isoformat()
        await publish(
            support_channel(case.id), {"type": "message.created", "message": message_payload}
        )
    return result


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
