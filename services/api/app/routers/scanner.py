import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import func, or_, select

from app.access import get_event_or_404, require_event_permission
from app.deps import CurrentUser, DbSession
from app.enums import CheckInAction, StaffRole, TicketStatus, UserRole
from app.errors import AppError
from app.models import CheckInRecord, Event, OrderItem, StaffAssignment, Ticket
from app.schemas import OfflineSyncRequest, ScanRequest, ScanResult
from app.security import (
    admission_public_key,
    create_admission_token,
    decode_admission_token,
    sign_detached_payload,
)
from app.services import record_audit

router = APIRouter(prefix="/scanner", tags=["scanner"])


@router.get("/public-key")
async def scanner_public_key() -> dict:
    return {"algorithm": "Ed25519", "version": 1, "public_key": admission_public_key()}


async def require_scanner_access(db: DbSession, event: Event, user: CurrentUser) -> None:
    await require_event_permission(db, event, user, {StaffRole.CHECK_IN, StaffRole.MANAGER})


async def parse_ticket(
    db: DbSession, request: ScanRequest
) -> tuple[Ticket | None, ScanResult | None]:
    try:
        payload = decode_admission_token(request.qr_token)
    except ValueError:
        message = (
            "Campaign QR codes are promotional links and cannot be used for admission."
            if request.qr_token.startswith(("http://", "https://"))
            else "This is not a valid BiletFlow admission QR."
        )
        return None, ScanResult(outcome="invalid", message=message)
    try:
        ticket_id = uuid.UUID(payload["tid"])
        token_event_id = uuid.UUID(payload["eid"])
    except (ValueError, KeyError):
        return None, ScanResult(outcome="invalid", message="The admission QR payload is malformed.")
    if token_event_id != request.event_id:
        return None, ScanResult(
            outcome="wrong_event",
            ticket_id=ticket_id,
            message="This ticket belongs to another event.",
        )
    ticket = await db.scalar(select(Ticket).where(Ticket.id == ticket_id).with_for_update())
    if (
        ticket is None
        or ticket.event_id != request.event_id
        or ticket.qr_nonce != payload.get("nonce")
        or ticket.ticket_code != payload.get("code")
    ):
        return None, ScanResult(
            outcome="invalid", message="Ticket authenticity could not be verified."
        )
    return ticket, None


async def attendee_name(db: DbSession, ticket: Ticket) -> str:
    value = await db.scalar(
        select(OrderItem.attendee_name).where(OrderItem.id == ticket.order_item_id)
    )
    return value or "Attendee"


async def apply_scan(
    db: DbSession, request: ScanRequest, user: CurrentUser, *, offline_sync: bool = False
) -> ScanResult:
    existing_operation = await db.scalar(
        select(CheckInRecord).where(CheckInRecord.operation_id == request.operation_id)
    )
    if existing_operation:
        ticket = await db.get(Ticket, existing_operation.ticket_id)
        return ScanResult(
            outcome="valid" if existing_operation.action == CheckInAction.CHECK_IN else "conflict",
            ticket_id=existing_operation.ticket_id,
            ticket_code=ticket.ticket_code if ticket else None,
            message="This scan was already synchronized.",
        )
    ticket, error = await parse_ticket(db, request)
    if error:
        return error
    assert ticket is not None
    name = await attendee_name(db, ticket)
    if ticket.status == TicketStatus.CANCELLED:
        return ScanResult(
            outcome="cancelled",
            ticket_id=ticket.id,
            ticket_code=ticket.ticket_code,
            attendee_name=name,
            message="This ticket was cancelled.",
        )
    if ticket.status == TicketStatus.REFUNDED:
        return ScanResult(
            outcome="refunded",
            ticket_id=ticket.id,
            ticket_code=ticket.ticket_code,
            attendee_name=name,
            message="This ticket was refunded.",
        )
    last_reversal_at = await db.scalar(
        select(func.max(CheckInRecord.captured_at)).where(
            CheckInRecord.ticket_id == ticket.id, CheckInRecord.action == CheckInAction.REVERSAL
        )
    )
    checkins_statement = select(CheckInRecord).where(
        CheckInRecord.ticket_id == ticket.id,
        CheckInRecord.action == CheckInAction.CHECK_IN,
    )
    if last_reversal_at:
        checkins_statement = checkins_statement.where(CheckInRecord.captured_at > last_reversal_at)
    accepted = await db.scalar(
        checkins_statement.order_by(CheckInRecord.captured_at, CheckInRecord.operation_id).limit(1)
    )
    if accepted:
        if offline_sync and (request.captured_at, request.operation_id) < (
            accepted.captured_at,
            accepted.operation_id,
        ):
            db.add(
                CheckInRecord(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    admin_user_id=user.id,
                    action=CheckInAction.CHECK_IN,
                    operation_id=request.operation_id,
                    captured_at=request.captured_at,
                    was_offline=True,
                    details={"supersedes_later_operation": accepted.operation_id},
                )
            )
            db.add(
                CheckInRecord(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    admin_user_id=user.id,
                    action=CheckInAction.CONFLICT,
                    operation_id=f"conflict-{accepted.operation_id}-{request.operation_id}"[:100],
                    captured_at=datetime.now(UTC),
                    was_offline=True,
                    details={
                        "operation_id": accepted.operation_id,
                        "accepted_operation": request.operation_id,
                    },
                )
            )
            return ScanResult(
                outcome="valid",
                ticket_id=ticket.id,
                ticket_code=ticket.ticket_code,
                attendee_name=name,
                message="Accepted as the earliest offline check-in; a later scan was flagged.",
            )
        db.add(
            CheckInRecord(
                ticket_id=ticket.id,
                event_id=ticket.event_id,
                admin_user_id=user.id,
                action=CheckInAction.CONFLICT,
                operation_id=request.operation_id,
                captured_at=request.captured_at,
                was_offline=offline_sync or request.was_offline,
                details={"accepted_operation": accepted.operation_id},
            )
        )
        return ScanResult(
            outcome="conflict" if offline_sync else "already_used",
            ticket_id=ticket.id,
            ticket_code=ticket.ticket_code,
            attendee_name=name,
            message="This ticket has already been checked in.",
        )
    ticket.status = TicketStatus.CHECKED_IN
    db.add(
        CheckInRecord(
            ticket_id=ticket.id,
            event_id=ticket.event_id,
            admin_user_id=user.id,
            action=CheckInAction.CHECK_IN,
            operation_id=request.operation_id,
            captured_at=request.captured_at,
            was_offline=offline_sync or request.was_offline,
        )
    )
    await record_audit(
        db,
        action="ticket.checked_in",
        entity_type="ticket",
        entity_id=ticket.id,
        event_id=ticket.event_id,
        actor_user_id=user.id,
        description=f"Checked in ticket {ticket.ticket_code}.",
        data={"offline": offline_sync or request.was_offline},
    )
    return ScanResult(
        outcome="valid",
        ticket_id=ticket.id,
        ticket_code=ticket.ticket_code,
        attendee_name=name,
        message="Ticket accepted. Welcome!",
    )


@router.get("/events")
async def assigned_events(user: CurrentUser, db: DbSession) -> list[dict]:
    assigned = select(StaffAssignment.event_id).where(
        StaffAssignment.user_id == user.id,
        StaffAssignment.role.in_([StaffRole.CHECK_IN, StaffRole.MANAGER]),
    )
    statement = select(Event).where(or_(Event.owner_id == user.id, Event.id.in_(assigned)))
    if UserRole.PLATFORM_ADMIN.value in user.roles:
        statement = select(Event)
    events = (await db.scalars(statement.order_by(Event.starts_at))).all()
    result = []
    for event in events:
        registered = await db.scalar(
            select(func.count()).select_from(Ticket).where(Ticket.event_id == event.id)
        )
        checked = await db.scalar(
            select(func.count())
            .select_from(Ticket)
            .where(Ticket.event_id == event.id, Ticket.status == TicketStatus.CHECKED_IN)
        )
        result.append(
            {
                "id": str(event.id),
                "title": event.title,
                "starts_at": event.starts_at,
                "venue_name": event.venue_name,
                "registered": registered or 0,
                "checked_in": checked or 0,
            }
        )
    return result


@router.post("/scan", response_model=ScanResult)
async def scan_ticket(request: ScanRequest, user: CurrentUser, db: DbSession) -> ScanResult:
    event = await get_event_or_404(db, request.event_id)
    await require_scanner_access(db, event, user)
    result = await apply_scan(db, request, user)
    await db.commit()
    return result


@router.post("/tickets/{ticket_id}/reverse", response_model=ScanResult)
async def reverse_check_in(
    ticket_id: uuid.UUID, operation_id: str, user: CurrentUser, db: DbSession
) -> ScanResult:
    ticket = await db.scalar(select(Ticket).where(Ticket.id == ticket_id).with_for_update())
    if ticket is None:
        raise AppError(404, "ticket_not_found", "Ticket not found", "The ticket does not exist.")
    event = await get_event_or_404(db, ticket.event_id)
    await require_scanner_access(db, event, user)
    if ticket.status != TicketStatus.CHECKED_IN:
        raise AppError(
            409, "ticket_not_checked_in", "Cannot reverse", "The ticket is not checked in."
        )
    if await db.scalar(select(CheckInRecord.id).where(CheckInRecord.operation_id == operation_id)):
        return ScanResult(
            outcome="valid",
            ticket_id=ticket.id,
            ticket_code=ticket.ticket_code,
            message="This reversal was already recorded.",
        )
    ticket.status = TicketStatus.VALID
    db.add(
        CheckInRecord(
            ticket_id=ticket.id,
            event_id=ticket.event_id,
            admin_user_id=user.id,
            action=CheckInAction.REVERSAL,
            operation_id=operation_id,
            captured_at=datetime.now(UTC),
            was_offline=False,
        )
    )
    await record_audit(
        db,
        action="ticket.check_in_reversed",
        entity_type="ticket",
        entity_id=ticket.id,
        event_id=ticket.event_id,
        actor_user_id=user.id,
        description=f"Reversed check-in for {ticket.ticket_code}.",
    )
    await db.commit()
    return ScanResult(
        outcome="valid",
        ticket_id=ticket.id,
        ticket_code=ticket.ticket_code,
        message="Check-in reversed; the ticket is valid again.",
    )


@router.get("/events/{event_id}/attendees")
async def search_attendees(
    event_id: uuid.UUID, user: CurrentUser, db: DbSession, q: str = ""
) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_scanner_access(db, event, user)
    statement = (
        select(Ticket, OrderItem)
        .join(OrderItem, OrderItem.id == Ticket.order_item_id)
        .where(Ticket.event_id == event.id)
        .order_by(OrderItem.attendee_name)
        .limit(50)
    )
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                OrderItem.attendee_name.ilike(pattern),
                OrderItem.attendee_email.ilike(pattern),
                Ticket.ticket_code.ilike(pattern),
            )
        )
    rows = (await db.execute(statement)).all()
    return [
        {
            "ticket_id": str(ticket.id),
            "ticket_code": ticket.ticket_code,
            "name": item.attendee_name,
            "email": item.attendee_email,
            "status": ticket.status,
            "seat": " ".join(filter(None, [item.section, item.row, item.seat_number])),
        }
        for ticket, item in rows
    ]


@router.get("/events/{event_id}/bundle")
async def offline_bundle(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_scanner_access(db, event, user)
    rows = (
        await db.execute(
            select(Ticket, OrderItem)
            .join(OrderItem, OrderItem.id == Ticket.order_item_id)
            .where(Ticket.event_id == event.id)
        )
    ).all()
    payload = {
        "version": 1,
        "event_id": str(event.id),
        "generated_at": datetime.now(UTC).isoformat(),
        "expires_at": (event.ends_at + timedelta(days=1)).isoformat(),
        "public_key": admission_public_key(),
        "tickets": [
            {
                "id": str(ticket.id),
                "code": ticket.ticket_code,
                "status": ticket.status,
                "attendee_name": item.attendee_name,
                "seat": {"section": item.section, "row": item.row, "number": item.seat_number},
                "qr_token": create_admission_token(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    nonce=ticket.qr_nonce,
                    ticket_code=ticket.ticket_code,
                ),
            }
            for ticket, item in rows
        ],
    }
    encoded, signature = sign_detached_payload(payload)
    return {"payload": payload, "encoded": encoded, "signature": signature}


@router.post("/sync")
async def sync_offline_scans(request: OfflineSyncRequest, user: CurrentUser, db: DbSession) -> dict:
    operations = sorted(request.operations, key=lambda item: (item.captured_at, item.operation_id))
    results = []
    authorized_events: set[uuid.UUID] = set()
    for operation in operations:
        if operation.event_id not in authorized_events:
            event = await get_event_or_404(db, operation.event_id)
            await require_scanner_access(db, event, user)
            authorized_events.add(operation.event_id)
        result = await apply_scan(db, operation, user, offline_sync=True)
        results.append({"operation_id": operation.operation_id, **result.model_dump(mode="json")})
        # The session deliberately disables autoflush. Persist each append-only action so
        # a later operation in the same synchronization batch observes the winning scan.
        await db.flush()
    await db.commit()
    return {
        "accepted": sum(item["outcome"] == "valid" for item in results),
        "conflicts": sum(item["outcome"] in {"conflict", "already_used"} for item in results),
        "results": results,
    }
