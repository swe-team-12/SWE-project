from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response
from sqlalchemy import select

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.enums import NotificationType, UserRole
from app.errors import AppError
from app.models import ActionToken, OrganizerProfile, RefreshSession, User
from app.schemas import (
    AuthTokens,
    LoginRequest,
    OrganizerProfileRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    UserOut,
    VerifyEmailRequest,
)
from app.security import (
    create_access_token,
    hash_password,
    opaque_token,
    refresh_expiry,
    token_hash,
    verify_password,
)
from app.services import create_notification, enqueue_email, record_audit

router = APIRouter(prefix="/auth", tags=["authentication"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "biletflow_refresh",
        token,
        max_age=settings.refresh_token_days * 86_400,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/api/v1/auth",
    )


async def _issue_tokens(
    db: DbSession,
    response: Response,
    user: User,
    request: Request,
    device_name: str | None = None,
) -> AuthTokens:
    access, expires = create_access_token(user.id, user.roles)
    refresh = opaque_token(48)
    db.add(
        RefreshSession(
            user_id=user.id,
            token_hash=token_hash(refresh),
            expires_at=refresh_expiry(),
            device_name=device_name,
            user_agent=request.headers.get("user-agent"),
        )
    )
    _set_refresh_cookie(response, refresh)
    return AuthTokens(
        access_token=access,
        expires_at=expires,
        refresh_token=refresh,
        user=UserOut.model_validate(user),
    )


@router.post("/register", status_code=201)
async def register(payload: RegisterRequest, db: DbSession) -> dict:
    email = payload.email.lower()
    exists = await db.scalar(select(User.id).where(User.email == email))
    if exists:
        raise AppError(409, "email_in_use", "Email already registered", "Use another email.")
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        locale=payload.locale,
        roles=[UserRole.ATTENDEE.value],
    )
    db.add(user)
    await db.flush()
    raw_token = opaque_token()
    db.add(
        ActionToken(
            user_id=user.id,
            purpose="verify_email",
            token_hash=token_hash(raw_token),
            expires_at=datetime.now(UTC) + timedelta(hours=24),
        )
    )
    await create_notification(
        db,
        user_id=user.id,
        type=NotificationType.ACCOUNT_VERIFICATION,
        title="Verify your BiletFlow account",
        body="Open the verification link sent to your email.",
    )
    await record_audit(
        db,
        action="account.registered",
        entity_type="user",
        entity_id=user.id,
        actor_user_id=user.id,
        description="User registered an account.",
    )
    await db.commit()
    enqueue_email(
        user.email,
        "Verify your BiletFlow account",
        (
            "Welcome to BiletFlow. Verify your email using this link:\n\n"
            f"{settings.public_web_base_url}/verify-email?token={raw_token}\n\n"
            "This link expires in 24 hours."
        ),
    )
    response: dict = {"message": "Verification email queued", "user_id": str(user.id)}
    if not settings.is_production:
        response["development_verification_token"] = raw_token
    return response


@router.post("/verify-email", response_model=UserOut)
async def verify_email(payload: VerifyEmailRequest, db: DbSession) -> User:
    token = await db.scalar(
        select(ActionToken).where(
            ActionToken.token_hash == token_hash(payload.token),
            ActionToken.purpose == "verify_email",
            ActionToken.consumed_at.is_(None),
        )
    )
    if token is None or token.expires_at < datetime.now(UTC):
        raise AppError(400, "invalid_verification_token", "Invalid link", "Request a new link.")
    user = await db.get(User, token.user_id)
    if user is None:
        raise AppError(404, "user_not_found", "User not found", "The account no longer exists.")
    user.is_email_verified = True
    token.consumed_at = datetime.now(UTC)
    await record_audit(
        db,
        action="account.email_verified",
        entity_type="user",
        entity_id=user.id,
        actor_user_id=user.id,
        description="Email address verified.",
    )
    await db.commit()
    return user


@router.post("/login", response_model=AuthTokens)
async def login(
    payload: LoginRequest, request: Request, response: Response, db: DbSession
) -> AuthTokens:
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AppError(
            401, "invalid_credentials", "Sign-in failed", "Email or password is invalid."
        )
    if user.is_suspended:
        raise AppError(403, "account_suspended", "Account suspended", "Contact support.")
    user.last_login_at = datetime.now(UTC)
    tokens = await _issue_tokens(db, response, user, request, payload.device_name)
    await db.commit()
    return tokens


@router.post("/refresh", response_model=AuthTokens)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    response: Response,
    db: DbSession,
    biletflow_refresh: Annotated[str | None, Cookie()] = None,
) -> AuthTokens:
    raw = payload.refresh_token or biletflow_refresh
    if not raw:
        raise AppError(401, "refresh_required", "Session expired", "Sign in again.")
    session = await db.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == token_hash(raw)).with_for_update()
    )
    if session is None or session.revoked_at is not None or session.expires_at < datetime.now(UTC):
        raise AppError(401, "invalid_refresh_token", "Session expired", "Sign in again.")
    user = await db.get(User, session.user_id)
    if user is None or user.is_suspended:
        raise AppError(401, "inactive_user", "Account unavailable", "Sign in again.")
    session.revoked_at = datetime.now(UTC)
    tokens = await _issue_tokens(db, response, user, request, session.device_name)
    await db.commit()
    return tokens


@router.post("/logout", status_code=204)
async def logout(
    payload: RefreshRequest,
    response: Response,
    db: DbSession,
    biletflow_refresh: Annotated[str | None, Cookie()] = None,
) -> None:
    raw = payload.refresh_token or biletflow_refresh
    if raw:
        session = await db.scalar(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash(raw))
        )
        if session:
            session.revoked_at = datetime.now(UTC)
            await db.commit()
    response.delete_cookie("biletflow_refresh", path="/api/v1/auth")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


@router.post("/password-reset/request")
async def request_password_reset(payload: PasswordResetRequest, db: DbSession) -> dict:
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    result = {"message": "If the account exists, a reset link has been queued."}
    if user:
        raw = opaque_token()
        db.add(
            ActionToken(
                user_id=user.id,
                purpose="password_reset",
                token_hash=token_hash(raw),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await db.commit()
        enqueue_email(
            user.email,
            "Reset your BiletFlow password",
            (
                "Reset your BiletFlow password using this one-use link:\n\n"
                f"{settings.public_web_base_url}/reset-password?token={raw}\n\n"
                "This link expires in one hour."
            ),
        )
        if not settings.is_production:
            result["development_reset_token"] = raw
    return result


@router.post("/password-reset/confirm")
async def confirm_password_reset(payload: PasswordResetConfirm, db: DbSession) -> dict:
    token = await db.scalar(
        select(ActionToken).where(
            ActionToken.token_hash == token_hash(payload.token),
            ActionToken.purpose == "password_reset",
            ActionToken.consumed_at.is_(None),
        )
    )
    if token is None or token.expires_at < datetime.now(UTC):
        raise AppError(400, "invalid_reset_token", "Invalid link", "Request a new reset link.")
    user = await db.get(User, token.user_id)
    if user is None:
        raise AppError(404, "user_not_found", "User not found", "The account no longer exists.")
    user.password_hash = hash_password(payload.password)
    token.consumed_at = datetime.now(UTC)
    sessions = await db.scalars(
        select(RefreshSession).where(
            RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None)
        )
    )
    for session in sessions:
        session.revoked_at = datetime.now(UTC)
    await db.commit()
    return {"message": "Password updated. Sign in again."}


@router.put("/organizer-profile")
async def upsert_organizer_profile(
    payload: OrganizerProfileRequest, user: CurrentUser, db: DbSession
) -> dict:
    profile = await db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))
    if profile is None:
        profile = OrganizerProfile(user_id=user.id, **payload.model_dump())
        db.add(profile)
    else:
        for key, value in payload.model_dump().items():
            setattr(profile, key, value)
    if UserRole.ORGANIZER.value not in user.roles:
        user.roles = [*user.roles, UserRole.ORGANIZER.value]
    await record_audit(
        db,
        action="organizer.profile_updated",
        entity_type="organizer_profile",
        entity_id=profile.id,
        actor_user_id=user.id,
        description="Organizer profile created or updated.",
    )
    await db.commit()
    return {
        "id": str(profile.id),
        "organization_name": profile.organization_name,
        "identity_verified": profile.identity_verified,
        "payout_verified": profile.payout_verified,
    }
