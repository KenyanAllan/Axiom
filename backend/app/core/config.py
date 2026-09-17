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
        "postgresql+asyncpg://axiom:axiom_dev_secret@localhost:5432/axiom"
    )
    sync_database_url: str = (
        "postgresql+psycopg2://axiom:axiom_dev_secret@localhost:5432/axiom"
    )
    database_ssl: bool = False

    # ── Redis / Celery ──────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── AWS / Bedrock ───────────────────────────────────────────────────────────
    aws_default_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    bedrock_model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    bedrock_embed_model_id: str = "amazon.titan-embed-text-v2:0"

    # ── Amazon S3 ───────────────────────────────────────────────────────────────
    s3_bucket_name: str = "axiom-source-documents"
    s3_presigned_url_expiry: int = 3600

    # ── Amazon Transcribe ───────────────────────────────────────────────────────
    transcribe_output_bucket: str = "axiom-transcriptions"

    # ── Amazon Polly ────────────────────────────────────────────────────────────
    polly_output_bucket: str = "axiom-audio"
    polly_voice_id: str = "Matthew"
    polly_engine: str = "neural"

    # ── JWT Auth ────────────────────────────────────────────────────────────────
    jwt_secret_key: str = "CHANGE-ME-to-a-random-64-char-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    # ── App ─────────────────────────────────────────────────────────────────────
    log_level: str = "info"
    environment: str = "development"
    xp_per_correct_answer: int = 50
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    upload_max_bytes: int = 50 * 1024 * 1024  # 50 MB

    # ── Demo auth ───────────────────────────────────────────────────────────────
    enable_demo_auth: bool = True
    demo_user_ids: list[str] = ["usr_student_demo", "usr_teacher_demo", "usr_learner_demo"]
    run_seed_on_startup: bool = True


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.environment == "production" and s.jwt_secret_key == "CHANGE-ME-to-a-random-64-char-string":
        raise RuntimeError(
            "FATAL: JWT_SECRET_KEY must be set to a secure random value in production. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    return s
