import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.enums import (
    DiscountType,
    EventStatus,
    EventVisibility,
    OrderStatus,
    PaymentStatus,
    SeatingMode,
    StaffRole,
    SupportCategory,
    SupportKind,
    UserRole,
)
from app.models import (
    AnalyticsEvent,
    Campaign,
    Event,
    Order,
    OrderItem,
    OrganizerProfile,
    Payment,
    StaffAssignment,
    SupportCase,
    SupportMessage,
    Ticket,
    TicketType,
    User,
    VenueSeat,
)
from app.routers.events import seed_almaty_hall
from app.security import hash_password, opaque_token
from app.services import record_audit


async def get_or_create_user(
    db, email: str, name: str, roles: list[str], *, legacy_email: str | None = None
) -> User:
    user = await db.scalar(select(User).where(User.email == email))
    if user is None and legacy_email:
        user = await db.scalar(select(User).where(User.email == legacy_email))
        if user is not None:
            user.email = email
    if user:
        user.display_name = name
        user.roles = roles
        user.is_email_verified = True
        return user
    user = User(
        email=email,
        display_name=name,
        password_hash=hash_password(settings.demo_password),
        locale="en",
        roles=roles,
        is_email_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def seed() -> None:
    async with SessionLocal() as db:
        admin = await get_or_create_user(
            db,
            "admin@example.com",
            "Platform Admin",
            [UserRole.ATTENDEE.value, UserRole.PLATFORM_ADMIN.value],
            legacy_email="admin@biletflow.local",
        )
        organizer = await get_or_create_user(
            db,
            "organizer@example.com",
            "Aruzhan Organizer",
            [UserRole.ATTENDEE.value, UserRole.ORGANIZER.value],
            legacy_email="organizer@biletflow.local",
        )
        attendee = await get_or_create_user(
            db,
            "attendee@example.com",
            "Dias Attendee",
            [UserRole.ATTENDEE.value],
            legacy_email="attendee@biletflow.local",
        )
        scanner = await get_or_create_user(
            db,
            "scanner@example.com",
            "Event Check-in",
            [UserRole.ATTENDEE.value],
            legacy_email="scanner@biletflow.local",
        )
        profile = await db.scalar(
            select(OrganizerProfile).where(OrganizerProfile.user_id == organizer.id)
        )
        if profile is None:
            db.add(
                OrganizerProfile(
                    user_id=organizer.id,
                    organization_name="BiletFlow Demo Events",
                    contact_email=organizer.email,
                    contact_phone="+7 700 000 0000",
                    identity_verified=True,
                    payout_account_label="Demo payout account",
                    payout_verified=True,
                )
            )
        else:
            profile.contact_email = organizer.email
        event = await db.scalar(select(Event).where(Event.slug == "almaty-tech-forum-2026"))
        if event is None:
            event = Event(
                owner_id=organizer.id,
                slug="almaty-tech-forum-2026",
                title="Almaty Tech Forum 2026",
                description="A full BiletFlow demonstration event with assigned seating, campaigns, support, analytics, and online or offline check-in.",
                category="Technology",
                venue_name="Almaty Hall",
                venue_address="Abay Avenue 44, Almaty",
                city="Almaty",
                starts_at=datetime.now(UTC) + timedelta(days=14),
                ends_at=datetime.now(UTC) + timedelta(days=14, hours=6),
                timezone="Asia/Almaty",
                registration_opens_at=datetime.now(UTC) - timedelta(days=7),
                registration_closes_at=datetime.now(UTC) + timedelta(days=14),
                capacity=168,
                status=EventStatus.PUBLISHED,
                visibility=EventVisibility.PUBLIC,
                seating_mode=SeatingMode.ASSIGNED,
                terms_accepted=True,
                activation_paid=True,
                paid_sales_active=True,
            )
            db.add(event)
            await db.flush()
            await seed_almaty_hall(db, event)
            await db.flush()
            premium = TicketType(
                event_id=event.id,
                name="Premium",
                description="Center-section seating with priority entry.",
                price_tiyin=2_500_000,
                quantity=36,
                max_per_order=4,
                price_category="premium",
            )
            standard = TicketType(
                event_id=event.id,
                name="Standard",
                description="General assigned seating.",
                price_tiyin=1_200_000,
                quantity=126,
                max_per_order=6,
                price_category="standard",
            )
            accessible = TicketType(
                event_id=event.id,
                name="Accessible",
                description="Accessible seating allocation.",
                price_tiyin=1_200_000,
                quantity=6,
                max_per_order=2,
                price_category="accessible",
            )
            db.add_all([premium, standard, accessible])
            await db.flush()
            campaign = Campaign(
                event_id=event.id,
                created_by_id=organizer.id,
                name="Campus launch",
                code="CAMPUS20",
                opaque_token=opaque_token(24),
                discount_type=DiscountType.PERCENTAGE,
                discount_value=20,
                starts_at=datetime.now(UTC) - timedelta(days=1),
                ends_at=datetime.now(UTC) + timedelta(days=10),
                max_redemptions=100,
                applicable_ticket_type_ids=[str(standard.id)],
            )
            db.add(campaign)
            db.add(
                StaffAssignment(
                    event_id=event.id,
                    user_id=scanner.id,
                    role=StaffRole.CHECK_IN,
                    assigned_by_id=organizer.id,
                )
            )
            await record_audit(
                db,
                action="event.seeded",
                entity_type="event",
                entity_id=event.id,
                event_id=event.id,
                actor_user_id=admin.id,
                description="Created the Almaty Hall demonstration event.",
            )
            # Seed a canonical paid order and ticket for scanner and PDF demonstrations.
            seat = await db.scalar(
                select(VenueSeat).where(
                    VenueSeat.event_id == event.id,
                    VenueSeat.section == "A",
                    VenueSeat.row == "A",
                    VenueSeat.number == "2",
                )
            )
            from app.enums import CheckoutStatus
            from app.models import CheckoutSession

            session = CheckoutSession(
                user_id=attendee.id,
                event_id=event.id,
                status=CheckoutStatus.COMPLETED,
                expires_at=datetime.now(UTC),
                subtotal_tiyin=premium.price_tiyin,
                total_tiyin=premium.price_tiyin,
                processing_fee_tiyin=75_000,
                idempotency_key="seed-checkout-almaty-tech",
            )
            db.add(session)
            await db.flush()
            order = Order(
                order_number="BF-DEMO-0001",
                user_id=attendee.id,
                event_id=event.id,
                checkout_session_id=session.id,
                status=OrderStatus.PAID,
                subtotal_tiyin=premium.price_tiyin,
                discount_tiyin=0,
                processing_fee_tiyin=75_000,
                total_tiyin=premium.price_tiyin,
                organizer_net_tiyin=premium.price_tiyin - 75_000,
            )
            db.add(order)
            await db.flush()
            item = OrderItem(
                order_id=order.id,
                ticket_type_id=premium.id,
                seat_id=seat.id if seat else None,
                unit_price_tiyin=premium.price_tiyin,
                attendee_name=attendee.display_name,
                attendee_email=attendee.email,
                section=seat.section if seat else None,
                row=seat.row if seat else None,
                seat_number=seat.number if seat else None,
            )
            db.add(item)
            await db.flush()
            db.add(
                Ticket(
                    ticket_code="TKT-DEMO-0001",
                    order_item_id=item.id,
                    event_id=event.id,
                    owner_user_id=attendee.id,
                    qr_nonce=opaque_token(18),
                )
            )
            db.add(
                Payment(
                    order_id=order.id,
                    event_id=event.id,
                    user_id=attendee.id,
                    status=PaymentStatus.SUCCEEDED,
                    amount_tiyin=order.total_tiyin,
                    provider_reference="demo-seed-payment",
                    idempotency_key="seed-payment-almaty-tech",
                )
            )
            support_case = SupportCase(
                case_number="SUP-DEMO-0001",
                kind=SupportKind.ATTENDEE_TO_ORGANIZER,
                category=SupportCategory.SEATING,
                requester_id=attendee.id,
                event_id=event.id,
                order_id=order.id,
                subject="Where is the accessible entrance?",
            )
            db.add(support_case)
            await db.flush()
            db.add(
                SupportMessage(
                    case_id=support_case.id,
                    sender_id=attendee.id,
                    body="Could you confirm which entrance has step-free access?",
                )
            )
            for index, name in enumerate(
                ["event_view"] * 18
                + ["campaign_view"] * 12
                + ["checkout_start"] * 7
                + ["purchase_demo"] * 3
            ):
                db.add(
                    AnalyticsEvent(
                        event_id=event.id,
                        campaign_id=campaign.id if "campaign" in name else None,
                        anonymous_id=f"seed-anon-{index:03d}",
                        name=name,
                        occurred_at=datetime.now(UTC) - timedelta(hours=index * 3),
                        properties={"source": "seeded-demo"},
                    )
                )
        # Reconcile the canonical hall coordinates on every seed run so
        # existing demonstration databases receive layout refinements without
        # replacing seats, orders, or ticket references.
        await seed_almaty_hall(db, event)
        seeded_payment = await db.scalar(
            select(Payment).where(Payment.provider_reference == "demo-seed-payment")
        )
        if seeded_payment is not None:
            seeded_payment.status = PaymentStatus.SUCCEEDED
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
