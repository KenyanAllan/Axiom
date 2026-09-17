"""Auth endpoints — register and login with JWT."""

from __future__ import annotations

import logging
import random
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, hash_password, verify_password
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.tables import User, Workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_ICONS = ["🧠", "🔬", "📐", "💡", "🎯", "🚀", "⚡", "🧮", "📊", "🎓", "🌟", "🔭", "🧪", "📚", "🎨"]
AVATAR_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#10b981", "#06b6d4", "#6366f1", "#e11d48"]


def random_avatar() -> str:
    return f"{random.choice(AVATAR_ICONS)}|{random.choice(AVATAR_COLORS)}"


# ── Schemas ──────────────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=100)
    role: Literal["student", "teacher", "individual_learner"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserOut(BaseModel):
    id: str
    display_name: str
    email: str | None = None
    role: str
    avatar: str | None = None
    xp: int
    level: int
    streak_days: int
    last_active_date: str | None = None
    workspace_id: int | None = None

    model_config = {"from_attributes": True}


# Fix forward reference — AuthResponse references UserOut which is defined after it.
AuthResponse.model_rebuild()


# ── POST /api/auth/register ─────────────────────────────────────────────────


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@router.post("/register/", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:

    # Check if email already taken
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        logger.warning("Registration rejected: duplicate email %s", body.email)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    user = User(
        id=user_id,
        display_name=body.display_name,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        avatar=random_avatar(),
        xp=0,
        level=1,
        streak_days=0,
    )
    db.add(user)
    await db.flush()

    workspace = Workspace(
        user_id=user_id,
        title=f"{body.display_name}'s Workbench",
        is_classroom_shared=False,
    )
    db.add(workspace)
    await db.flush()

    token = create_access_token(user_id)
    logger.info("User registered: user_id=%s email=%s workspace_id=%d", user_id, body.email, workspace.id)
    user_out = UserOut.model_validate(user)
    user_out.workspace_id = workspace.id
    return AuthResponse(
        access_token=token,
        user=user_out,
    )


# ── POST /api/auth/login ────────────────────────────────────────────────────


@router.post("/login", response_model=AuthResponse)
@router.post("/login/", response_model=AuthResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or user.hashed_password is None:
        logger.warning("Login failed: no account for email %s", body.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not verify_password(body.password, user.hashed_password):
        logger.warning("Login failed: wrong password for email %s", body.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    ws_result = await db.execute(
        select(Workspace.id).where(Workspace.user_id == user.id).limit(1)
    )
    ws_id = ws_result.scalar_one_or_none()

    token = create_access_token(user.id)
    logger.info("User logged in: user_id=%s", user.id)
    user_out = UserOut.model_validate(user)
    user_out.workspace_id = ws_id
    return AuthResponse(
        access_token=token,
        user=user_out,
    )
