import uuid

from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.enums import EventStatus, EventVisibility, OrderStatus, StaffRole, UserRole
from app.errors import AppError
from app.models import (
    Event,
    EventInvitation,
    Order,
    StaffAssignment,
    SupportCase,
    SystemSetting,
    User,
)

ACTIVATION_FEE_KEY = "activation_fee_tiyin"


def is_platform_admin(user: User | None) -> bool:
    return bool(user and UserRole.PLATFORM_ADMIN.value in (user.roles or []))


async def platform_admins(db: AsyncSession) -> list[User]:
    """Active platform administrators (roles are stored as a JSON list)."""
    candidates = (
        await db.scalars(
            select(User).where(
                cast(User.roles, String).like(f"%{UserRole.PLATFORM_ADMIN.value}%"),
                User.is_suspended.is_(False),
            )
        )
    ).all()
    return [user for user in candidates if is_platform_admin(user)]


async def platform_admin_ids(db: AsyncSession) -> set[uuid.UUID]:
    return {user.id for user in await platform_admins(db)}


async def ticket_holder_ids(db: AsyncSession, event_id: uuid.UUID) -> set[uuid.UUID]:
    """Users holding a paid or free order for the event."""
    result = await db.scalars(
        select(Order.user_id)
        .where(
            Order.event_id == event_id,
            Order.status.in_([OrderStatus.PAID, OrderStatus.FREE]),
        )
        .distinct()
    )
    return set(result.all())


async def activation_fee_setting(db: AsyncSession) -> tuple[int, SystemSetting | None]:
    """Return the effective activation fee and the stored setting, if one was configured."""
    setting = await db.scalar(select(SystemSetting).where(SystemSetting.key == ACTIVATION_FEE_KEY))
    if setting is not None and "amount_tiyin" in (setting.value or {}):
        return int(setting.value["amount_tiyin"]), setting
    return settings.activation_fee_tiyin, None


async def get_event_or_404(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    return event


async def event_roles(db: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID) -> set[str]:
    result = await db.scalars(
        select(StaffAssignment.role).where(
            StaffAssignment.event_id == event_id, StaffAssignment.user_id == user_id
        )
    )
    return {role.value for role in result.all()}


async def can_manage_event(db: AsyncSession, event: Event, user: User | None) -> bool:
    if user is None:
        return False
    if UserRole.PLATFORM_ADMIN.value in user.roles or event.owner_id == user.id:
        return True
    return bool(await event_roles(db, event.id, user.id))


async def require_event_view_access(
    db: AsyncSession, event: Event, user: User | None
) -> None:
    """Apply lifecycle and private-invitation rules to every attendee-facing resource."""
    if await can_manage_event(db, event, user):
        return
    if event.status not in {EventStatus.PUBLISHED, EventStatus.CANCELLED}:
        raise AppError(404, "event_not_found", "Event not found", "The event is unavailable.")
    if event.visibility != EventVisibility.PRIVATE:
        return
    invited = None
    if user is not None:
        invited = await db.scalar(
            select(EventInvitation.id).where(
                EventInvitation.event_id == event.id,
                EventInvitation.email == user.email,
                EventInvitation.accepted_by_user_id == user.id,
            )
        )
    if not invited:
        raise AppError(
            403, "invitation_required", "Invitation required", "Open your invitation link."
        )


async def require_event_permission(
    db: AsyncSession,
    event: Event,
    user: User,
    allowed_staff_roles: set[StaffRole] | None = None,
) -> None:
    if UserRole.PLATFORM_ADMIN.value in user.roles or event.owner_id == user.id:
        return
    assigned = await event_roles(db, event.id, user.id)
    allowed = {role.value for role in (allowed_staff_roles or set(StaffRole))}
    if not assigned.intersection(allowed):
        raise AppError(
            403,
            "event_permission_denied",
            "Permission denied",
            "You are not authorized to manage this event.",
        )


async def require_support_access(db: AsyncSession, case: SupportCase, user: User) -> None:
    if case.requester_id == user.id or UserRole.PLATFORM_ADMIN.value in user.roles:
        return
    if case.event_id:
        event = await get_event_or_404(db, case.event_id)
        if event.owner_id == user.id:
            return
        roles = await event_roles(db, case.event_id, user.id)
        if StaffRole.SUPPORT.value in roles or StaffRole.MANAGER.value in roles:
            return
    raise AppError(
        403,
        "support_permission_denied",
        "Permission denied",
        "You cannot access this support case.",
    )


def event_change_data(
    event: Event, change: str, reason: str | None = None, **extra: object
) -> dict[str, object]:
    """Machine-readable notification payload so clients can localise event changes."""
    data: dict[str, object] = {
        "event_id": str(event.id),
        "event_title": event.title,
        "event_status": event.status.value if event.status else None,
        "change": change,
        "reason": reason,
    }
    data.update(extra)
    return data
