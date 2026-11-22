import hashlib
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.access import get_event_or_404, require_event_permission
from app.deps import CurrentUser, DbSession
from app.documents import seat_label
from app.enums import CheckInAction, StaffRole, TicketStatus, UserRole
from app.errors import AppError
from app.models import CheckInRecord, Event, Order, OrderItem, StaffAssignment, Ticket, TicketType
from app.schemas import OfflineSyncRequest, ScanRequest, ScanResult
from app.security import (
    admission_public_key,
    create_admission_token,
    decode_admission_token,
    sign_detached_payload,
)
from app.services import record_audit

router = APIRouter(prefix="/scanner", tags=["scanner"])

# Scan result messages are English; clients localise by `outcome`.
REGISTERED_STATUSES = (TicketStatus.VALID, TicketStatus.CHECKED_IN)


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
    except (ValueError, KeyError, TypeError):
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


async def ticket_context(db: DbSession, ticket: Ticket) -> dict:
    """Attendee-facing details shown next to a scan result."""
    row = (
        await db.execute(
            select(OrderItem, TicketType.name)
            .join(TicketType, TicketType.id == OrderItem.ticket_type_id, isouter=True)
            .where(OrderItem.id == ticket.order_item_id)
        )
    ).first()
    if row is None:
        return {"attendee_name": "Attendee"}
    item, type_name = row
    return {
        "attendee_name": item.attendee_name or "Attendee",
        "ticket_type_name": type_name,
        "seat_label": seat_label(item),
    }


def scan_result(
    outcome: str,
    ticket: Ticket,
    context: dict,
    message: str,
    checked_in_at: datetime | None = None,
) -> ScanResult:
    return ScanResult(
        outcome=outcome,  # type: ignore[arg-type]
        ticket_id=ticket.id,
        ticket_code=ticket.ticket_code,
        ticket_status=ticket.status,
        checked_in_at=checked_in_at,
        message=message,
        **context,
    )


def conflict_operation_id(accepted_operation: str, losing_operation: str) -> str:
    """Deterministic, collision-safe id (<=100 chars) for a derived conflict record."""
    digest = hashlib.sha256(f"{accepted_operation}|{losing_operation}".encode()).hexdigest()
    return f"conflict-{digest[:48]}"


async def replayed_operation(db: DbSession, operation_id: str) -> ScanResult | None:
    """Idempotency: an operation id that was already recorded returns its stored outcome."""
    existing = await db.scalar(
        select(CheckInRecord).where(CheckInRecord.operation_id == operation_id)
    )
    if existing is None:
        return None
    ticket = await db.get(Ticket, existing.ticket_id)
    if existing.action == CheckInAction.CHECK_IN:
        outcome, message = "valid", "This scan was already synchronized."
    elif existing.action == CheckInAction.REVERSAL:
        outcome, message = "valid", "This reversal was already recorded."
    else:
        outcome = "conflict" if existing.was_offline else "already_used"
        message = "This scan was already recorded as a duplicate."
    context = await ticket_context(db, ticket) if ticket else {}
    return ScanResult(
        outcome=outcome,  # type: ignore[arg-type]
        ticket_id=existing.ticket_id,
        ticket_code=ticket.ticket_code if ticket else None,
        ticket_status=ticket.status if ticket else None,
        checked_in_at=existing.captured_at if existing.action == CheckInAction.CHECK_IN else None,
        message=message,
        **context,
    )


async def check_in_ticket(
    db: DbSession,
    ticket: Ticket,
    user: CurrentUser,
    *,
    operation_id: str,
    captured_at: datetime,
    was_offline: bool = False,
    offline_sync: bool = False,
    method: str = "qr",
) -> ScanResult:
    """Admit one (row-locked) ticket. Shared by QR scans, manual check-in and offline sync."""
    context = await ticket_context(db, ticket)
    if ticket.status == TicketStatus.CANCELLED:
        return scan_result("cancelled", ticket, context, "This ticket was cancelled.")
    if ticket.status == TicketStatus.REFUNDED:
        return scan_result("refunded", ticket, context, "This ticket was refunded.")
    offline = offline_sync or was_offline
    now = datetime.now(UTC)
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
    if accepted is None and ticket.status == TicketStatus.CHECKED_IN:
        # Defensive: the ticket is admitted but its record predates the last reversal
        # window (clock skew). Never admit the same ticket twice.
        accepted = await db.scalar(
            select(CheckInRecord)
            .where(
                CheckInRecord.ticket_id == ticket.id,
                CheckInRecord.action == CheckInAction.CHECK_IN,
            )
            .order_by(CheckInRecord.created_at.desc())
            .limit(1)
        )
        if accepted is not None:
            db.add(
                CheckInRecord(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    admin_user_id=user.id,
                    action=CheckInAction.CONFLICT,
                    operation_id=operation_id,
                    captured_at=captured_at,
                    was_offline=offline,
                    details={"accepted_operation": accepted.operation_id, "method": method},
                )
            )
            return scan_result(
                "conflict" if offline_sync else "already_used",
                ticket,
                context,
                "This ticket has already been checked in.",
                accepted.captured_at,
            )
    if accepted:
        if offline_sync and (captured_at, operation_id) < (
            accepted.captured_at,
            accepted.operation_id,
        ):
            db.add(
                CheckInRecord(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    admin_user_id=user.id,
                    action=CheckInAction.CHECK_IN,
                    operation_id=operation_id,
                    captured_at=captured_at,
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
                    operation_id=conflict_operation_id(accepted.operation_id, operation_id),
                    captured_at=now,
                    was_offline=True,
                    details={
                        "operation_id": accepted.operation_id,
                        "accepted_operation": operation_id,
                    },
                )
            )
            await record_audit(
                db,
                action="ticket.check_in_conflict",
                entity_type="ticket",
                entity_id=ticket.id,
                event_id=ticket.event_id,
                actor_user_id=user.id,
                description=(
                    f"Offline scan of {ticket.ticket_code} predates the accepted check-in; "
                    "the later scan was flagged as a duplicate."
                ),
                data={
                    "accepted_operation": operation_id,
                    "superseded_operation": accepted.operation_id,
                    "offline": True,
                },
            )
            return scan_result(
                "valid",
                ticket,
                context,
                "Accepted as the earliest offline check-in; a later scan was flagged.",
                captured_at,
            )
        db.add(
            CheckInRecord(
                ticket_id=ticket.id,
                event_id=ticket.event_id,
                admin_user_id=user.id,
                action=CheckInAction.CONFLICT,
                operation_id=operation_id,
                captured_at=captured_at,
                was_offline=offline,
                details={"accepted_operation": accepted.operation_id, "method": method},
            )
        )
        if offline_sync:
            await record_audit(
                db,
                action="ticket.check_in_conflict",
                entity_type="ticket",
                entity_id=ticket.id,
                event_id=ticket.event_id,
                actor_user_id=user.id,
                description=f"Duplicate offline scan of {ticket.ticket_code} was rejected.",
                data={
                    "accepted_operation": accepted.operation_id,
                    "rejected_operation": operation_id,
                    "offline": True,
                },
            )
        return scan_result(
            "conflict" if offline_sync else "already_used",
            ticket,
            context,
            "This ticket has already been checked in.",
            accepted.captured_at,
        )
    if last_reversal_at and captured_at <= last_reversal_at:
        if offline_sync:
            # The offline scan happened before a later, deliberate reversal: the
            # reversal wins, so the ticket stays valid and the scan is only recorded.
            db.add(
                CheckInRecord(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    admin_user_id=user.id,
                    action=CheckInAction.CONFLICT,
                    operation_id=operation_id,
                    captured_at=captured_at,
                    was_offline=True,
                    details={"superseded_by_reversal_at": last_reversal_at.isoformat()},
                )
            )
            return scan_result(
                "conflict",
                ticket,
                context,
                "This offline scan predates a later check-in reversal; scan the ticket again.",
            )
        # Online scan from a device whose clock lags the server: order it after the
        # reversal so the admission stays visible to the duplicate check.
        captured_at = max(now, last_reversal_at + timedelta(microseconds=1))
    ticket.status = TicketStatus.CHECKED_IN
    db.add(
        CheckInRecord(
            ticket_id=ticket.id,
            event_id=ticket.event_id,
            admin_user_id=user.id,
            action=CheckInAction.CHECK_IN,
            operation_id=operation_id,
            captured_at=captured_at,
            was_offline=offline,
            details={"method": method},
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
        data={"offline": offline, "method": method, "operation_id": operation_id},
    )
    return scan_result("valid", ticket, context, "Ticket accepted. Welcome!", captured_at)


async def apply_scan(
    db: DbSession, request: ScanRequest, user: CurrentUser, *, offline_sync: bool = False
) -> ScanResult:
    replay = await replayed_operation(db, request.operation_id)
    if replay is not None:
        return replay
    ticket, error = await parse_ticket(db, request)
    if error:
        return error
    assert ticket is not None
    return await check_in_ticket(
        db,
        ticket,
        user,
        operation_id=request.operation_id,
        captured_at=request.captured_at,
        was_offline=request.was_offline,
        offline_sync=offline_sync,
    )


async def event_totals(db: DbSession, event_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Admission totals per event. Refunded/cancelled tickets are not registered."""
    totals: dict[uuid.UUID, dict] = {
        event_id: {
            "registered": 0,
            "checked_in": 0,
            "remaining": 0,
            "cancelled": 0,
            "refunded": 0,
        }
        for event_id in event_ids
    }
    if not event_ids:
        return totals
    rows = (
        await db.execute(
            select(Ticket.event_id, Ticket.status, func.count())
            .where(Ticket.event_id.in_(event_ids))
            .group_by(Ticket.event_id, Ticket.status)
        )
    ).all()
    for event_id, status, count in rows:
        bucket = totals[event_id]
        if status in REGISTERED_STATUSES:
            bucket["registered"] += count
        if status == TicketStatus.CHECKED_IN:
            bucket["checked_in"] += count
        elif status == TicketStatus.VALID:
            bucket["remaining"] += count
        elif status == TicketStatus.CANCELLED:
            bucket["cancelled"] += count
        elif status == TicketStatus.REFUNDED:
            bucket["refunded"] += count
    return totals


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
    totals = await event_totals(db, [event.id for event in events])
    return [
        {
            "id": str(event.id),
            "title": event.title,
            "starts_at": event.starts_at,
            "ends_at": event.ends_at,
            "timezone": event.timezone,
            "status": event.status,
            "venue_name": event.venue_name,
            **totals[event.id],
        }
        for event in events
    ]


@router.get("/events/{event_id}/totals")
async def scanner_event_totals(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_scanner_access(db, event, user)
    return {"event_id": str(event.id), **(await event_totals(db, [event.id]))[event.id]}


@router.post("/scan", response_model=ScanResult)
async def scan_ticket(request: ScanRequest, user: CurrentUser, db: DbSession) -> ScanResult:
    event = await get_event_or_404(db, request.event_id)
    await require_scanner_access(db, event, user)
    result = await apply_scan(db, request, user)
    await db.commit()
    return result


async def _locked_ticket_for_staff(
    db: DbSession, ticket_id: uuid.UUID, user: CurrentUser
) -> Ticket:
    ticket = await db.scalar(select(Ticket).where(Ticket.id == ticket_id).with_for_update())
    if ticket is None:
        raise AppError(404, "ticket_not_found", "Ticket not found", "The ticket does not exist.")
    event = await get_event_or_404(db, ticket.event_id)
    await require_scanner_access(db, event, user)
    return ticket


@router.post("/tickets/{ticket_id}/check-in", response_model=ScanResult)
async def check_in_by_ticket_id(
    ticket_id: uuid.UUID,
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    operation_id: str = Query(min_length=8, max_length=100),
) -> ScanResult:
    """Manual check-in from the attendee search list (no QR needed)."""
    ticket = await _locked_ticket_for_staff(db, ticket_id, user)
    replay = await replayed_operation(db, operation_id)
    if replay is not None:
        return replay
    if ticket.event_id != event_id:
        return scan_result(
            "wrong_event",
            ticket,
            {},
            "This ticket belongs to another event.",
        )
    result = await check_in_ticket(
        db,
        ticket,
        user,
        operation_id=operation_id,
        captured_at=datetime.now(UTC),
        method="manual",
    )
    await db.commit()
    return result


@router.post("/tickets/{ticket_id}/reverse", response_model=ScanResult)
async def reverse_check_in(
    ticket_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    operation_id: str = Query(min_length=8, max_length=100),
    event_id: uuid.UUID | None = None,
) -> ScanResult:
    ticket = await _locked_ticket_for_staff(db, ticket_id, user)
    context = await ticket_context(db, ticket)
    # Idempotency first: replaying a recorded reversal must not fail with 409.
    if await db.scalar(select(CheckInRecord.id).where(CheckInRecord.operation_id == operation_id)):
        return scan_result("valid", ticket, context, "This reversal was already recorded.")
    if event_id is not None and ticket.event_id != event_id:
        return scan_result("wrong_event", ticket, {}, "This ticket belongs to another event.")
    if ticket.status != TicketStatus.CHECKED_IN:
        raise AppError(
            409, "ticket_not_checked_in", "Cannot reverse", "The ticket is not checked in."
        )
    ticket.status = TicketStatus.VALID
    # Order the reversal after every recorded check-in, even one captured by a
    # device whose clock runs ahead, so that check-in cannot linger as "accepted".
    latest_check_in = await db.scalar(
        select(func.max(CheckInRecord.captured_at)).where(
            CheckInRecord.ticket_id == ticket.id, CheckInRecord.action == CheckInAction.CHECK_IN
        )
    )
    reversed_at = datetime.now(UTC)
    if latest_check_in and latest_check_in >= reversed_at:
        reversed_at = latest_check_in + timedelta(microseconds=1)
    db.add(
        CheckInRecord(
            ticket_id=ticket.id,
            event_id=ticket.event_id,
            admin_user_id=user.id,
            action=CheckInAction.REVERSAL,
            operation_id=operation_id,
            captured_at=reversed_at,
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
        data={"operation_id": operation_id},
    )
    await db.commit()
    return scan_result(
        "valid", ticket, context, "Check-in reversed; the ticket is valid again."
    )


@router.get("/events/{event_id}/attendees")
async def search_attendees(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    q: str = "",
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_scanner_access(db, event, user)
    statement = (
        select(Ticket, OrderItem, TicketType.name, Order.order_number)
        .join(OrderItem, OrderItem.id == Ticket.order_item_id)
        .join(TicketType, TicketType.id == OrderItem.ticket_type_id, isouter=True)
        .join(Order, Order.id == OrderItem.order_id, isouter=True)
        .where(Ticket.event_id == event.id)
        .order_by(OrderItem.attendee_name, Ticket.ticket_code)
        .limit(limit)
    )
    if q.strip():
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                OrderItem.attendee_name.ilike(pattern),
                OrderItem.attendee_email.ilike(pattern),
                Ticket.ticket_code.ilike(pattern),
                Order.order_number.ilike(pattern),
            )
        )
    rows = (await db.execute(statement)).all()
    checked_ids = [row[0].id for row in rows if row[0].status == TicketStatus.CHECKED_IN]
    checked_at: dict[uuid.UUID, datetime] = {}
    if checked_ids:
        checked_at = {
            ticket_id: moment
            for ticket_id, moment in (
                await db.execute(
                    select(CheckInRecord.ticket_id, func.max(CheckInRecord.captured_at))
                    .where(
                        CheckInRecord.ticket_id.in_(checked_ids),
                        CheckInRecord.action == CheckInAction.CHECK_IN,
                    )
                    .group_by(CheckInRecord.ticket_id)
                )
            ).all()
        }
    return [
        {
            "ticket_id": str(ticket.id),
            "ticket_code": ticket.ticket_code,
            "name": item.attendee_name,
            "email": item.attendee_email,
            "status": ticket.status,
            "checked_in": ticket.status == TicketStatus.CHECKED_IN,
            "checked_in_at": checked_at.get(ticket.id),
            "can_check_in": ticket.status == TicketStatus.VALID,
            "seat": " ".join(filter(None, [item.section, item.row, item.seat_number])),
            "seat_label": seat_label(item),
            "ticket_type_name": type_name,
            "order_number": order_number,
        }
        for ticket, item, type_name, order_number in rows
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
            .order_by(Ticket.ticket_code)
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
    """Apply queued offline scans in capture order.

    Every operation gets its own result and savepoint: one unauthorised, unknown or
    conflicting operation never discards the rest of the batch, and re-sending a
    batch is harmless because operation ids are idempotent.
    """
    operations = sorted(request.operations, key=lambda item: (item.captured_at, item.operation_id))
    results: list[dict] = []
    authorized_events: set[uuid.UUID] = set()
    denied_events: dict[uuid.UUID, str] = {}
    for operation in operations:
        if operation.event_id not in authorized_events and operation.event_id not in denied_events:
            try:
                event = await get_event_or_404(db, operation.event_id)
                await require_scanner_access(db, event, user)
                authorized_events.add(operation.event_id)
            except AppError as error:
                denied_events[operation.event_id] = error.code
        if operation.event_id in denied_events:
            results.append(
                {
                    "operation_id": operation.operation_id,
                    **ScanResult(
                        outcome="invalid",
                        message="You are not assigned to check in attendees for this event.",
                    ).model_dump(mode="json"),
                    "code": denied_events[operation.event_id],
                }
            )
            continue
        try:
            async with db.begin_nested():
                result = await apply_scan(db, operation, user, offline_sync=True)
                # The session deliberately disables autoflush. Persist each append-only
                # action so a later operation in the same batch observes the winning scan.
                await db.flush()
        except IntegrityError:
            # Another device synchronized the same operation id concurrently.
            replay = await replayed_operation(db, operation.operation_id)
            result = replay or ScanResult(
                outcome="conflict", message="This scan was already synchronized."
            )
        results.append({"operation_id": operation.operation_id, **result.model_dump(mode="json")})
    await db.commit()
    return {
        "accepted": sum(item["outcome"] == "valid" for item in results),
        "conflicts": sum(item["outcome"] in {"conflict", "already_used"} for item in results),
        "rejected": sum(
            item["outcome"] in {"invalid", "wrong_event", "cancelled", "refunded"}
            for item in results
        ),
        "results": results,
    }
