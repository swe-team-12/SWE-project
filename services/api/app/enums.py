from enum import StrEnum


class UserRole(StrEnum):
    ATTENDEE = "attendee"
    ORGANIZER = "organizer"
    PLATFORM_ADMIN = "platform_admin"


class EventStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    UNPUBLISHED = "unpublished"
    CANCELLED = "cancelled"
    SUSPENDED = "suspended"


class EventVisibility(StrEnum):
    PUBLIC = "public"
    UNLISTED = "unlisted"
    PRIVATE = "private"


class SeatingMode(StrEnum):
    GENERAL_ADMISSION = "general_admission"
    ASSIGNED = "assigned"


class StaffRole(StrEnum):
    MANAGER = "manager"
    SUPPORT = "support"
    FINANCE = "finance"
    CHECK_IN = "check_in"


class CheckoutStatus(StrEnum):
    OPEN = "open"
    COMPLETED = "completed"
    EXPIRED = "expired"
    FAILED = "failed"


class OrderStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    FREE = "free"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    REFUNDED = "refunded"


class TicketStatus(StrEnum):
    VALID = "valid"
    CHECKED_IN = "checked_in"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class DiscountType(StrEnum):
    PERCENTAGE = "percentage"
    FIXED_KZT = "fixed_kzt"


class SupportKind(StrEnum):
    ATTENDEE_TO_ORGANIZER = "attendee_to_organizer"
    ORGANIZER_TO_PLATFORM = "organizer_to_platform"


class SupportStatus(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING_FOR_CUSTOMER = "waiting_for_customer"
    RESOLVED = "resolved"


class SupportCategory(StrEnum):
    TICKET_DELIVERY = "ticket_delivery"
    PAYMENT = "payment"
    REFUND = "refund"
    SEATING = "seating"
    EVENT_INFORMATION = "event_information"
    CHECK_IN = "check_in"
    ACCOUNT = "account"
    TECHNICAL = "technical"
    ACTIVATION = "activation"


class CheckInAction(StrEnum):
    CHECK_IN = "check_in"
    REVERSAL = "reversal"
    CONFLICT = "conflict"


class NotificationType(StrEnum):
    ACCOUNT_VERIFICATION = "account_verification"
    ORDER_CONFIRMED = "order_confirmed"
    PAYMENT_FAILED = "payment_failed"
    TICKET_DELIVERED = "ticket_delivered"
    EVENT_UPDATED = "event_updated"
    EVENT_CANCELLED = "event_cancelled"
    REFUND_COMPLETED = "refund_completed"
    PAYOUT_STATUS = "payout_status"
    SUPPORT_MESSAGE = "support_message"
    SUPPORT_STATUS = "support_status"
