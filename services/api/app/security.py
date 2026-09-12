import base64
import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pwdlib import PasswordHash

from app.config import settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def create_access_token(user_id: uuid.UUID, roles: list[str]) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": str(user_id),
        "roles": roles,
        "type": "access",
        "iat": datetime.now(UTC),
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256"), expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload


def opaque_token(size: int = 32) -> str:
    return secrets.token_urlsafe(size)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def refresh_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=settings.refresh_token_days)


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _admission_private_key() -> Ed25519PrivateKey:
    seed = hashlib.sha256(settings.admission_signing_secret.encode()).digest()
    return Ed25519PrivateKey.from_private_bytes(seed)


def admission_public_key() -> str:
    raw = (
        _admission_private_key()
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )
    return _b64url(raw)


def sign_detached_payload(payload: dict[str, Any]) -> tuple[str, str]:
    encoded = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = _admission_private_key().sign(encoded.encode())
    return encoded, _b64url(signature)


def create_admission_token(
    *, ticket_id: uuid.UUID, event_id: uuid.UUID, nonce: str, ticket_code: str
) -> str:
    payload = {
        "typ": "admission",
        "v": 1,
        "tid": str(ticket_id),
        "eid": str(event_id),
        "nonce": nonce,
        "code": ticket_code,
    }
    encoded = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = _admission_private_key().sign(encoded.encode())
    return f"bft:v1:{encoded}.{_b64url(signature)}"


def decode_admission_token(token: str) -> dict[str, Any]:
    if not token.startswith("bft:v1:"):
        raise ValueError("not_admission_qr")
    body = token.removeprefix("bft:v1:")
    try:
        encoded, signature = body.split(".", 1)
        _admission_private_key().public_key().verify(_b64decode(signature), encoded.encode())
        payload = json.loads(_b64decode(encoded))
    except Exception as exc:
        raise ValueError("invalid_admission_qr") from exc
    if payload.get("typ") != "admission" or payload.get("v") != 1:
        raise ValueError("invalid_admission_qr")
    return payload
