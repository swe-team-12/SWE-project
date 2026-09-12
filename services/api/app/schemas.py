import uuid
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.enums import (
    DiscountType,
    EventStatus,
    EventVisibility,
    SeatingMode,
    StaffRole,
    SupportCategory,
    SupportKind,
    SupportStatus,
    TicketStatus,
)


def require_timezone(value: datetime | None) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError("datetime must include an explicit UTC offset")
    return value


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ORMModel):
    id: uuid.UUID
    email: EmailStr
    display_name: str
    locale: str
    roles: list[str]
    is_email_verified: bool
    is_suspended: bool


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=2, max_length=160)
    locale: Literal["kk", "ru", "en"] = "kk"

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if not any(char.isalpha() for char in value) or not any(char.isdigit() for char in value):
            raise ValueError("Password must include a letter and a number")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_name: str | None = Field(default=None, max_length=120)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class VerifyEmailRequest(BaseModel):
    token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    password: str = Field(min_length=10, max_length=128)


class AuthTokens(BaseModel):
    access_token: str
    expires_at: datetime
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: UserOut


class OrganizerProfileRequest(BaseModel):
    organization_name: str = Field(min_length=2, max_length=200)
    contact_phone: str | None = Field(default=None, max_length=40)
    contact_email: EmailStr
    payout_account_label: str | None = Field(default=None, max_length=100)


class EventCreate(BaseModel):
    title: str = Field(min_length=3, max_length=220)
    description: str = Field(min_length=10, max_length=20_000)
    category: str = Field(min_length=2, max_length=80)
    venue_name: str = Field(min_length=2, max_length=220)
    venue_address: str = Field(min_length=3, max_length=500)
    city: str = Field(default="Almaty", max_length=100)
    starts_at: datetime
    ends_at: datetime
    timezone: str = "Asia/Almaty"
    registration_opens_at: datetime | None = None
    registration_closes_at: datetime | None = None
    capacity: int = Field(gt=0, le=100_000)
    visibility: EventVisibility = EventVisibility.PUBLIC
    seating_mode: SeatingMode = SeatingMode.GENERAL_ADMISSION
    refund_policy: str = Field(
        default="Full refunds are available until the event starts.", max_length=2_000
    )

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA identifier") from exc
        return value

    @field_validator(
        "starts_at", "ends_at", "registration_opens_at", "registration_closes_at"
    )
    @classmethod
    def timezone_aware_dates(cls, value: datetime | None) -> datetime | None:
        return require_timezone(value)

    @model_validator(mode="after")
    def dates_are_ordered(self) -> "EventCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.registration_opens_at and self.registration_closes_at:
            if self.registration_closes_at <= self.registration_opens_at:
                raise ValueError("registration_closes_at must be after registration_opens_at")
        return self


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=220)
    description: str | None = Field(default=None, min_length=10, max_length=20_000)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    venue_name: str | None = Field(default=None, min_length=2, max_length=220)
    venue_address: str | None = Field(default=None, min_length=3, max_length=500)
    city: str | None = Field(default=None, max_length=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    timezone: str | None = None
    registration_opens_at: datetime | None = None
    registration_closes_at: datetime | None = None
    capacity: int | None = Field(default=None, gt=0, le=100_000)
    visibility: EventVisibility | None = None
    seating_mode: SeatingMode | None = None
    refund_policy: str | None = Field(default=None, max_length=2_000)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA identifier") from exc
        return value

    @field_validator(
        "starts_at", "ends_at", "registration_opens_at", "registration_closes_at"
    )
    @classmethod
    def timezone_aware_dates(cls, value: datetime | None) -> datetime | None:
        return require_timezone(value)


class TicketTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2_000)
    price_tiyin: int = Field(ge=0)
    quantity: int = Field(gt=0, le=100_000)
    max_per_order: int = Field(default=10, gt=0, le=50)
    sales_start_at: datetime | None = None
    sales_end_at: datetime | None = None
    price_category: str | None = Field(default=None, max_length=80)

    @field_validator("sales_start_at", "sales_end_at")
    @classmethod
    def timezone_aware_dates(cls, value: datetime | None) -> datetime | None:
        return require_timezone(value)

    @model_validator(mode="after")
    def sales_dates_are_ordered(self) -> "TicketTypeCreate":
        if self.sales_start_at and self.sales_end_at and self.sales_end_at <= self.sales_start_at:
            raise ValueError("sales_end_at must be after sales_start_at")
        return self


class TicketTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2_000)
    price_tiyin: int | None = Field(default=None, ge=0)
    quantity: int | None = Field(default=None, gt=0, le=100_000)
    max_per_order: int | None = Field(default=None, gt=0, le=50)
    sales_start_at: datetime | None = None
    sales_end_at: datetime | None = None
    is_hidden: bool | None = None
    price_category: str | None = Field(default=None, max_length=80)

    @field_validator("sales_start_at", "sales_end_at")
    @classmethod
    def timezone_aware_dates(cls, value: datetime | None) -> datetime | None:
        return require_timezone(value)


class TicketTypeOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str
    price_tiyin: int
    quantity: int
    max_per_order: int
    is_hidden: bool
    price_category: str | None


class EventOut(ORMModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    slug: str
    title: str
    description: str
    image_url: str | None = None
    category: str
    venue_name: str
    venue_address: str
    city: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    capacity: int
    status: EventStatus
    visibility: EventVisibility
    seating_mode: SeatingMode
    refund_policy: str
    paid_sales_active: bool
    paid_sales_suspended: bool
    ticket_types: list[TicketTypeOut] = Field(default_factory=list)
    lifecycle_group: str | None = None


class StaffAssignmentRequest(BaseModel):
    email: EmailStr
    role: StaffRole


class CampaignCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    code: str | None = Field(default=None, min_length=3, max_length=40)
    discount_type: DiscountType
    discount_value: int = Field(gt=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_redemptions: int | None = Field(default=None, gt=0)
    applicable_ticket_type_ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def timezone_aware_dates(cls, value: datetime | None) -> datetime | None:
        return require_timezone(value)

    @model_validator(mode="after")
    def campaign_dates_are_ordered(self) -> "CampaignCreate":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class CampaignOut(ORMModel):
    id: uuid.UUID
    event_id: uuid.UUID
    name: str
    code: str
    opaque_token: str
    discount_type: DiscountType
    discount_value: int
    starts_at: datetime | None
    ends_at: datetime | None
    max_redemptions: int | None
    is_enabled: bool
    applicable_ticket_type_ids: list[str]
    campaign_url: str | None = None


class CheckoutLineRequest(BaseModel):
    ticket_type_id: uuid.UUID
    quantity: int = Field(default=1, gt=0, le=50)
    seat_id: uuid.UUID | None = None
    attendee_name: str = Field(min_length=2, max_length=160)
    attendee_email: EmailStr


class CheckoutCreate(BaseModel):
    event_id: uuid.UUID
    lines: list[CheckoutLineRequest] = Field(min_length=1, max_length=50)
    promo_code: str | None = Field(default=None, max_length=40)
    idempotency_key: str = Field(min_length=8, max_length=100)


class CheckoutConfirm(BaseModel):
    outcome: Literal["success", "failure", "timeout"] = "success"
    idempotency_key: str = Field(min_length=8, max_length=100)


class ActivationSimulation(BaseModel):
    outcome: Literal["success", "failure", "timeout"] = "success"
    idempotency_key: str = Field(min_length=8, max_length=100)
    terms_accepted: bool
    organizer_verification_confirmed: bool


class CheckoutOut(ORMModel):
    id: uuid.UUID
    event_id: uuid.UUID
    status: str
    expires_at: datetime
    subtotal_tiyin: int
    discount_tiyin: int
    processing_fee_tiyin: int
    total_tiyin: int


class TicketOut(ORMModel):
    id: uuid.UUID
    ticket_code: str
    event_id: uuid.UUID
    status: TicketStatus
    qr_token: str | None = None


class SupportCaseCreate(BaseModel):
    kind: SupportKind
    category: SupportCategory
    subject: str = Field(min_length=3, max_length=220)
    message: str = Field(min_length=1, max_length=10_000)
    event_id: uuid.UUID | None = None
    order_id: uuid.UUID | None = None
    ticket_id: uuid.UUID | None = None


class SupportMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)


class SupportStatusUpdate(BaseModel):
    status: SupportStatus
    assignee_id: uuid.UUID | None = None


class AnalyticsCapture(BaseModel):
    anonymous_id: str = Field(min_length=8, max_length=100)
    name: Literal["campaign_view", "event_view", "checkout_start", "purchase_demo"]
    event_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


class ScanRequest(BaseModel):
    qr_token: str
    event_id: uuid.UUID
    operation_id: str = Field(min_length=8, max_length=100)
    captured_at: datetime
    was_offline: bool = False

    @field_validator("captured_at")
    @classmethod
    def timezone_aware_capture(cls, value: datetime) -> datetime:
        result = require_timezone(value)
        assert result is not None
        return result


class OfflineScanOperation(ScanRequest):
    pass


class OfflineSyncRequest(BaseModel):
    operations: list[OfflineScanOperation] = Field(max_length=2_000)


class ScanResult(BaseModel):
    outcome: Literal[
        "valid",
        "invalid",
        "cancelled",
        "refunded",
        "already_used",
        "wrong_event",
        "conflict",
    ]
    ticket_id: uuid.UUID | None = None
    ticket_code: str | None = None
    attendee_name: str | None = None
    message: str
