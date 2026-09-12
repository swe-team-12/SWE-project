from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import (
    CheckInAction,
    CheckoutStatus,
    DiscountType,
    EventStatus,
    EventVisibility,
    NotificationType,
    OrderStatus,
    PaymentStatus,
    SeatingMode,
    StaffRole,
    SupportCategory,
    SupportKind,
    SupportStatus,
    TicketStatus,
)


def enum_column(enum_type: type, *, default: Any | None = None) -> Mapped[Any]:
    return mapped_column(
        Enum(
            enum_type,
            native_enum=False,
            values_callable=lambda values: [item.value for item in values],
        ),
        default=default,
        nullable=False,
    )


class UUIDMixin:
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(160))
    locale: Mapped[str] = mapped_column(String(8), default="kk")
    roles: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["attendee"])
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    organizer_profile: Mapped[OrganizerProfile | None] = relationship(
        back_populates="user", uselist=False
    )


class RefreshSession(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "refresh_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    device_name: Mapped[str | None] = mapped_column(String(120))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class ActionToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "action_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OrganizerProfile(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "organizer_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    organization_name: Mapped[str] = mapped_column(String(200))
    contact_phone: Mapped[str | None] = mapped_column(String(40))
    contact_email: Mapped[str] = mapped_column(String(320))
    identity_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    payout_account_label: Mapped[str | None] = mapped_column(String(100))
    payout_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="organizer_profile")


class Event(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "events"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(220), index=True)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(80), index=True)
    image_key: Mapped[str | None] = mapped_column(String(500))
    venue_name: Mapped[str] = mapped_column(String(220))
    venue_address: Mapped[str] = mapped_column(String(500))
    city: Mapped[str] = mapped_column(String(100), default="Almaty", index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Almaty")
    registration_opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    registration_closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    capacity: Mapped[int] = mapped_column(Integer)
    status: Mapped[EventStatus] = enum_column(EventStatus, default=EventStatus.DRAFT)
    visibility: Mapped[EventVisibility] = enum_column(
        EventVisibility, default=EventVisibility.PUBLIC
    )
    seating_mode: Mapped[SeatingMode] = enum_column(
        SeatingMode, default=SeatingMode.GENERAL_ADMISSION
    )
    refund_policy: Mapped[str] = mapped_column(
        Text, default="Full refunds are available until the event starts."
    )
    terms_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    activation_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    paid_sales_active: Mapped[bool] = mapped_column(Boolean, default=False)
    paid_sales_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    calendar_sequence: Mapped[int] = mapped_column(Integer, default=0)

    owner: Mapped[User] = relationship()
    ticket_types: Mapped[list[TicketType]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class EventInvitation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "event_invitations"
    __table_args__ = (UniqueConstraint("event_id", "email", name="uq_event_invitation_email"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(320), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    accepted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StaffAssignment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "staff_assignments"
    __table_args__ = (UniqueConstraint("event_id", "user_id", "role", name="uq_staff_role"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[StaffRole] = enum_column(StaffRole)
    assigned_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))


class TicketType(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "ticket_types"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    price_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    quantity: Mapped[int] = mapped_column(Integer)
    max_per_order: Mapped[int] = mapped_column(Integer, default=10)
    sales_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sales_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    price_category: Mapped[str | None] = mapped_column(String(80))

    event: Mapped[Event] = relationship(back_populates="ticket_types")


class VenueSeat(UUIDMixin, Base):
    __tablename__ = "venue_seats"
    __table_args__ = (
        UniqueConstraint("event_id", "section", "row", "number", name="uq_event_seat"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    section: Mapped[str] = mapped_column(String(40))
    row: Mapped[str] = mapped_column(String(20))
    number: Mapped[str] = mapped_column(String(20))
    price_category: Mapped[str] = mapped_column(String(80))
    is_accessible: Mapped[bool] = mapped_column(Boolean, default=False)
    is_unavailable: Mapped[bool] = mapped_column(Boolean, default=False)
    x: Mapped[int] = mapped_column(Integer)
    y: Mapped[int] = mapped_column(Integer)


class Campaign(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "campaigns"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    opaque_token: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    discount_type: Mapped[DiscountType] = enum_column(DiscountType)
    discount_value: Mapped[int] = mapped_column(BigInteger)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    applicable_ticket_type_ids: Mapped[list[str]] = mapped_column(JSON, default=list)


class CheckoutSession(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "checkout_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id"))
    status: Mapped[CheckoutStatus] = enum_column(CheckoutStatus, default=CheckoutStatus.OPEN)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    subtotal_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    discount_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    processing_fee_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    total_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)

    lines: Mapped[list[CheckoutLine]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class CheckoutLine(UUIDMixin, Base):
    __tablename__ = "checkout_lines"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkout_sessions.id", ondelete="CASCADE"), index=True
    )
    ticket_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ticket_types.id"), index=True)
    seat_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venue_seats.id"))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price_tiyin: Mapped[int] = mapped_column(BigInteger)
    attendee_name: Mapped[str] = mapped_column(String(160))
    attendee_email: Mapped[str] = mapped_column(String(320))

    session: Mapped[CheckoutSession] = relationship(back_populates="lines")


class SeatHold(UUIDMixin, Base):
    __tablename__ = "seat_holds"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkout_sessions.id", ondelete="CASCADE"), index=True
    )
    seat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("venue_seats.id", ondelete="CASCADE"), unique=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Order(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "orders"

    order_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    checkout_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkout_sessions.id"), unique=True
    )
    status: Mapped[OrderStatus] = enum_column(OrderStatus, default=OrderStatus.PENDING)
    subtotal_tiyin: Mapped[int] = mapped_column(BigInteger)
    discount_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    processing_fee_tiyin: Mapped[int] = mapped_column(BigInteger, default=0)
    total_tiyin: Mapped[int] = mapped_column(BigInteger)
    organizer_net_tiyin: Mapped[int] = mapped_column(BigInteger)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id"))

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(UUIDMixin, Base):
    __tablename__ = "order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    ticket_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ticket_types.id"), index=True)
    seat_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("venue_seats.id"), unique=True)
    unit_price_tiyin: Mapped[int] = mapped_column(BigInteger)
    attendee_name: Mapped[str] = mapped_column(String(160))
    attendee_email: Mapped[str] = mapped_column(String(320))
    section: Mapped[str | None] = mapped_column(String(40))
    row: Mapped[str | None] = mapped_column(String(20))
    seat_number: Mapped[str | None] = mapped_column(String(20))

    order: Mapped[Order] = relationship(back_populates="items")
    ticket: Mapped[Ticket | None] = relationship(back_populates="order_item", uselist=False)


class Payment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "payments"

    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40), default="ticket_purchase")
    status: Mapped[PaymentStatus] = enum_column(PaymentStatus, default=PaymentStatus.PENDING)
    amount_tiyin: Mapped[int] = mapped_column(BigInteger)
    provider: Mapped[str] = mapped_column(String(40), default="demo")
    provider_reference: Mapped[str] = mapped_column(String(120), unique=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    failure_reason: Mapped[str | None] = mapped_column(String(200))


class Refund(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "refunds"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    initiated_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    amount_tiyin: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[PaymentStatus] = enum_column(PaymentStatus, default=PaymentStatus.SUCCEEDED)
    reason: Mapped[str] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class Payout(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "payouts"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    amount_tiyin: Mapped[int] = mapped_column(BigInteger)
    eligible_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(40), default="scheduled")
    marked_paid_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Ticket(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tickets"

    ticket_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    order_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), unique=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[TicketStatus] = enum_column(TicketStatus, default=TicketStatus.VALID)
    qr_nonce: Mapped[str] = mapped_column(String(64), unique=True)
    pdf_object_key: Mapped[str | None] = mapped_column(String(500))

    order_item: Mapped[OrderItem] = relationship(back_populates="ticket")


class CheckInRecord(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "check_in_records"

    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    admin_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[CheckInAction] = enum_column(CheckInAction)
    operation_id: Mapped[str] = mapped_column(String(100), unique=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    was_offline: Mapped[bool] = mapped_column(Boolean, default=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class PromoRedemption(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "promo_redemptions"
    __table_args__ = (UniqueConstraint("campaign_id", "order_id", name="uq_campaign_order"),)

    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    discount_tiyin: Mapped[int] = mapped_column(BigInteger)


class SupportCase(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "support_cases"

    case_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    kind: Mapped[SupportKind] = enum_column(SupportKind)
    category: Mapped[SupportCategory] = enum_column(SupportCategory)
    status: Mapped[SupportStatus] = enum_column(SupportStatus, default=SupportStatus.OPEN)
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id"), index=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id"))
    subject: Mapped[str] = mapped_column(String(220))


class SupportMessage(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "support_messages"

    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("support_cases.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)


class SupportAttachment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "support_attachments"

    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("support_messages.id", ondelete="CASCADE"), index=True
    )
    object_key: Mapped[str] = mapped_column(String(500), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)


class Notification(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[NotificationType] = enum_column(NotificationType)
    title: Mapped[str] = mapped_column(String(220))
    body: Mapped[str] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AnalyticsEvent(UUIDMixin, Base):
    __tablename__ = "analytics_events"

    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id"), index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id"))
    anonymous_id: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(80), index=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )
    properties: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AuditLog(UUIDMixin, Base):
    __tablename__ = "audit_logs"

    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id"), index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True))
    description: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )


class SystemSetting(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), unique=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("ix_events_public_listing", Event.status, Event.visibility, Event.starts_at)
Index("ix_checkout_active_expiry", CheckoutSession.status, CheckoutSession.expires_at)
Index("ix_orders_event_status", Order.event_id, Order.status)
Index("ix_tickets_event_status", Ticket.event_id, Ticket.status)
Index("ix_support_case_event_status", SupportCase.event_id, SupportCase.status)
Index("ix_audit_event_time", AuditLog.event_id, AuditLog.occurred_at)
