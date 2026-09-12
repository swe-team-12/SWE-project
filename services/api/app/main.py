import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal
from app.errors import Problem, install_error_handlers
from app.routers import admin, analytics, auth, commerce, events, scanner, support, tickets


def validate_configuration() -> None:
    if not settings.is_production:
        return
    for name, value in (
        ("JWT_SECRET", settings.jwt_secret),
        ("ADMISSION_SIGNING_SECRET", settings.admission_signing_secret),
    ):
        if len(value.encode()) < 32 or value.startswith(("change-me", "development-")):
            raise RuntimeError(f"{name} must be replaced with at least 32 random bytes")
    if not settings.public_web_base_url.startswith("https://"):
        raise RuntimeError("PUBLIC_WEB_BASE_URL must use HTTPS in production")


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_configuration()
    yield


app = FastAPI(
    title="BiletFlow API",
    version="0.1.0",
    description="Academic demonstration event ticketing API. No real money is processed.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:19006"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "strict-origin-when-cross-origin"
    response.headers["server-timing"] = f"app;dur={(time.perf_counter() - started) * 1000:.1f}"
    return response


@app.middleware("http")
async def rate_limit_sensitive_routes(request: Request, call_next):
    scopes = {
        "/api/v1/auth/login": (20, 60),
        "/api/v1/auth/register": (10, 60),
        "/api/v1/checkout/sessions": (60, 60),
        "/api/v1/scanner/scan": (240, 60),
    }
    configured = next(
        (rule for path, rule in scopes.items() if request.url.path.startswith(path)), None
    )
    if configured:
        limit, window = configured
        client_ip = request.client.host if request.client else "unknown"
        key = f"ratelimit:{request.url.path}:{client_ip}:{int(time.time() // window)}"
        redis = Redis.from_url(settings.redis_url)
        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, window + 1)
            if count > limit:
                return JSONResponse(
                    Problem(
                        title="Too many requests",
                        status=429,
                        code="rate_limited",
                        detail="Wait before trying again.",
                        instance=request.url.path,
                    ).model_dump(exclude_none=True),
                    status_code=429,
                    media_type="application/problem+json",
                    headers={"Retry-After": str(window)},
                )
        except Exception:
            pass
        finally:
            await redis.aclose()
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    problem = Problem(
        title="Validation failed",
        status=422,
        code="validation_error",
        detail="One or more request fields are invalid.",
        instance=request.url.path,
        errors=[
            {"field": ".".join(str(part) for part in item["loc"]), "message": item["msg"]}
            for item in exc.errors()
        ],
    )
    return JSONResponse(
        problem.model_dump(exclude_none=True),
        status_code=422,
        media_type="application/problem+json",
    )


install_error_handlers(app)

for api_router in (
    auth.router,
    events.router,
    commerce.router,
    tickets.router,
    scanner.router,
    support.router,
    analytics.router,
    admin.router,
):
    app.include_router(api_router, prefix="/api/v1")


@app.get("/health/live", tags=["health"])
async def liveness() -> dict:
    return {"status": "ok", "service": "biletflow-api", "mode": "DEMONSTRATION_ONLY"}


@app.get("/health/ready", tags=["health"])
async def readiness() -> JSONResponse:
    checks: dict[str, str] = {}
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = type(exc).__name__
    redis = Redis.from_url(settings.redis_url)
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = type(exc).__name__
    finally:
        await redis.aclose()
    ready = all(value == "ok" for value in checks.values())
    return JSONResponse(
        {"status": "ok" if ready else "degraded", "checks": checks},
        status_code=200 if ready else 503,
    )
