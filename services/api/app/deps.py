import uuid
from typing import Annotated

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.enums import UserRole
from app.errors import AppError
from app.models import User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)
DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if credentials is None:
        raise AppError(401, "authentication_required", "Authentication required", "Sign in first.")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError) as exc:
        raise AppError(401, "invalid_access_token", "Invalid token", "Sign in again.") from exc
    user = await db.get(User, user_id)
    if user is None or user.is_suspended:
        raise AppError(401, "inactive_user", "Account unavailable", "This account is unavailable.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_optional_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User | None:
    if credentials is None:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
        user = await db.get(User, uuid.UUID(payload["sub"]))
    except (jwt.InvalidTokenError, ValueError, KeyError):
        return None
    return user if user and not user.is_suspended else None


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_role(user: User, role: UserRole) -> None:
    if role.value not in user.roles:
        raise AppError(
            403, "role_required", "Permission denied", f"The {role.value} role is required."
        )
