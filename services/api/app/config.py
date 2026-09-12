from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "BiletFlow API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://biletflow:biletflow@localhost:5433/biletflow"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "development-only-jwt-secret-at-least-32-bytes"
    admission_signing_secret: str = "development-admission-signing-secret-at-least-32-bytes"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    checkout_hold_minutes: int = 10
    activation_fee_tiyin: int = 500_000
    processor_fee_bps: int = 300
    public_web_base_url: str = "http://localhost:8081"
    api_public_url: str = "http://localhost:8010"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_from: str = "BiletFlow <noreply@biletflow.local>"
    s3_endpoint: str = "http://localhost:9100"
    s3_public_endpoint: str = "http://localhost:9100"
    s3_access_key: str = "biletflow"
    s3_secret_key: str = "change-me-minio"
    s3_bucket: str = "biletflow"
    ga4_measurement_id: str | None = Field(default=None)
    ga4_api_secret: str | None = Field(default=None)
    ga4_property_id: str | None = Field(default=None)
    ga4_access_token: str | None = Field(default=None)
    ga4_event_dimension: str = "customEvent:event_id"
    demo_password: str = "BiletFlowDemo123"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
