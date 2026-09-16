"""Minimal demo-auth dependency.

Reads `X-Demo-User` header — no Cognito, no JWTs.  Acceptable values:
  - usr_student_demo
  - usr_teacher_demo
"""

from fastapi import Header, HTTPException

from app.core.config import get_settings

settings = get_settings()

VALID_DEMO_IDS = set(settings.demo_user_ids)


async def get_current_user(
    x_demo_user: str = Header(..., alias="X-Demo-User"),
) -> str:
    """Return the demo user ID or 401."""
    if x_demo_user not in VALID_DEMO_IDS:
        raise HTTPException(
            status_code=401,
            detail=f"Unknown demo user. Use one of: {', '.join(sorted(VALID_DEMO_IDS))}",
        )
    return x_demo_user
