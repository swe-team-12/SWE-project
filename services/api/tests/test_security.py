import uuid

import jwt
import pytest

from app.config import settings
from app.security import (
    create_access_token,
    create_admission_token,
    decode_access_token,
    decode_admission_token,
    hash_password,
    verify_password,
)


def test_argon2id_password_hash_round_trip() -> None:
    encoded = hash_password("correct-horse-123")

    assert encoded.startswith("$argon2")
    assert verify_password("correct-horse-123", encoded)
    assert not verify_password("wrong-password-123", encoded)


def test_access_tokens_are_typed_and_expiring() -> None:
    user_id = uuid.uuid4()
    encoded, expires_at = create_access_token(user_id, ["attendee"])

    payload = decode_access_token(encoded)
    assert payload["sub"] == str(user_id)
    assert payload["roles"] == ["attendee"]
    assert payload["type"] == "access"
    assert expires_at.timestamp() == pytest.approx(payload["exp"], abs=1)


def test_admission_qr_is_signed_namespaced_and_contains_no_pii() -> None:
    ticket_id = uuid.uuid4()
    event_id = uuid.uuid4()
    token = create_admission_token(
        ticket_id=ticket_id,
        event_id=event_id,
        nonce="opaque-ticket-nonce",
        ticket_code="TKT-TEST-001",
    )

    assert token.startswith("bft:v1:")
    assert "attendee@example.com" not in token
    assert "Test Attendee" not in token
    payload = decode_admission_token(token)
    assert payload == {
        "typ": "admission",
        "v": 1,
        "tid": str(ticket_id),
        "eid": str(event_id),
        "nonce": "opaque-ticket-nonce",
        "code": "TKT-TEST-001",
    }

    encoded, signature = token.rsplit(".", 1)
    replacement = "A" if signature[-1] != "A" else "B"
    with pytest.raises(ValueError, match="invalid_admission_qr"):
        decode_admission_token(f"{encoded}.{signature[:-1]}{replacement}")


def test_refresh_or_other_jwt_cannot_be_used_as_access_token() -> None:
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "type": "refresh"},
        settings.jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(token)
