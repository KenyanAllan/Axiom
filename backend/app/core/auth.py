"""Dual-mode auth: JWT (primary) with X-Demo-User fallback.

Priority:
  1. Authorization: Bearer <token>  ->  validate JWT, extract user_id
  2. X-Demo-User header              ->  existing demo flow
  3. Neither                          ->  401
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Demo auth safety gate ──────────────────────────────────────────────────
# In production, demo auth MUST be disabled regardless of env var.
_demo_auth_enabled = settings.enable_demo_auth and settings.environment != "production"
if settings.enable_demo_auth and settings.environment == "production":
    logger.warning(
        "ENABLE_DEMO_AUTH=true is set in a PRODUCTION environment — "
        "demo auth has been FORCE-DISABLED. Remove ENABLE_DEMO_AUTH or set it to false."
    )
elif _demo_auth_enabled:
    logger.warning(
        "Demo authentication is ENABLED (environment=%s). "
        "Do NOT use this in production.",
        settings.environment,
    )

# ── Password hashing ────────────────────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

VALID_DEMO_IDS = set(settings.demo_user_ids)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT helpers ──────────────────────────────────────────────────────────────


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> str:
    """Decode a JWT and return the user_id (sub claim). Raises HTTPException on failure."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing sub claim",
            )
        return user_id
    except JWTError as exc:
        logger.warning("JWT decode failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ── FastAPI dependency ───────────────────────────────────────────────────────


async def get_current_user(
    authorization: str | None = Header(default=None),
    x_demo_user: str | None = Header(default=None, alias="X-Demo-User"),
) -> str:
    """Return the authenticated user ID.

    Checks Bearer token first, then falls back to demo header.
    """
    # 1. JWT auth
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        user_id = _decode_token(token)
        logger.debug("Authenticated user %s via JWT", user_id)
        return user_id

    # 2. Demo auth fallback (force-disabled in production regardless of env var)
    if x_demo_user:
        if not _demo_auth_enabled:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Demo authentication is disabled. Use Bearer token auth.",
            )
        if x_demo_user not in VALID_DEMO_IDS:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unknown demo user.",
            )
        logger.debug("Authenticated user %s via demo header", x_demo_user)
        return x_demo_user

    # 3. Demo mode default fallback (never in production)
    if _demo_auth_enabled:
        logger.debug("No credentials provided, defaulting to demo user usr_student_demo")
        return "usr_student_demo"

    # 4. No credentials
    logger.warning("Authentication attempt with no credentials")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing authentication. Provide Authorization: Bearer <token> or X-Demo-User header.",
    )
