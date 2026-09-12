import json
import uuid
from typing import Any

from redis.asyncio import Redis

from app.config import settings


def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


async def publish(channel: str, payload: dict[str, Any]) -> None:
    client = redis_client()
    try:
        await client.publish(channel, json.dumps(payload, default=str))
    finally:
        await client.aclose()


def support_channel(case_id: uuid.UUID) -> str:
    return f"support:{case_id}"


def user_channel(user_id: uuid.UUID) -> str:
    return f"notifications:{user_id}"
