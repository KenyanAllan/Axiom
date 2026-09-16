from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ────────────────────────────────────────────────────────────────
    database_url: str = (
        "postgresql+asyncpg://apkgs:apkgs_dev_secret@localhost:5432/apkgs"
    )
    sync_database_url: str = (
        "postgresql+psycopg2://apkgs:apkgs_dev_secret@localhost:5432/apkgs"
    )

    # ── Redis / Celery ──────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── AWS / Bedrock ───────────────────────────────────────────────────────────
    aws_default_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    bedrock_model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    bedrock_embed_model_id: str = "amazon.titan-embed-text-v2:0"

    # ── App ─────────────────────────────────────────────────────────────────────
    log_level: str = "info"
    xp_per_correct_answer: int = 50

    # ── Demo auth ───────────────────────────────────────────────────────────────
    demo_user_ids: list[str] = ["usr_student_demo", "usr_teacher_demo"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
