import json
import logging
import smtplib
import uuid
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any

import boto3
from botocore.client import Config
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.enums import NotificationType
from app.models import AuditLog, Notification

logger = logging.getLogger(__name__)


async def record_audit(
    db: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    description: str,
    actor_user_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> AuditLog:
    entry = AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        description=description,
        actor_user_id=actor_user_id,
        event_id=event_id,
        data=data or {},
    )
    db.add(entry)
    return entry


async def create_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    type: NotificationType,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> Notification:
    notification = Notification(user_id=user_id, type=type, title=title, body=body, data=data or {})
    db.add(notification)
    return notification


def send_email(
    to: str,
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    for filename, content, mime_type in attachments or []:
        main_type, sub_type = mime_type.split("/", 1)
        message.add_attachment(
            content,
            maintype=main_type,
            subtype=sub_type,
            filename=filename,
        )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        client.send_message(message)


def enqueue_email(to: str, subject: str, body: str) -> bool:
    """Queue mail after the related database transaction has committed."""
    try:
        from app.worker import email_task

        email_task.delay(to, subject, body)
        return True
    except Exception:
        logger.exception(
            "Unable to enqueue email", extra={"recipient_domain": to.rpartition("@")[2]}
        )
        return False


def enqueue_ticket_delivery(order_id: uuid.UUID) -> bool:
    try:
        from app.worker import deliver_order_tickets_task

        deliver_order_tickets_task.delay(str(order_id))
        return True
    except Exception:
        logger.exception("Unable to enqueue ticket delivery", extra={"order_id": str(order_id)})
        return False


def enqueue_ga4_event(
    anonymous_id: str, name: str, properties: dict[str, str | int | float | bool]
) -> bool:
    if not settings.ga4_measurement_id or not settings.ga4_api_secret:
        return False
    try:
        from app.worker import ga4_event_task

        ga4_event_task.delay(anonymous_id, name, properties)
        return True
    except Exception:
        logger.exception("Unable to enqueue GA4 event", extra={"event_name": name})
        return False


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def ensure_bucket() -> None:
    client = s3_client()
    buckets = {bucket["Name"] for bucket in client.list_buckets().get("Buckets", [])}
    if settings.s3_bucket not in buckets:
        client.create_bucket(Bucket=settings.s3_bucket)


def put_private_object(key: str, body: bytes, content_type: str) -> None:
    ensure_bucket()
    s3_client().put_object(Bucket=settings.s3_bucket, Key=key, Body=body, ContentType=content_type)


def signed_download_url(key: str, expires_seconds: int = 300) -> str:
    internal = s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires_seconds,
    )
    return internal.replace(settings.s3_endpoint, settings.s3_public_endpoint, 1)


def json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":"), default=str).encode()


def utcnow() -> datetime:
    return datetime.now(UTC)
