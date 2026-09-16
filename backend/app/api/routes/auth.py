"""Auth endpoints — register and login with JWT."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token, hash_password, verify_password
from app.core.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    display_name: str = Field(..., min_length=1)
    role: Literal["student", "teacher", "individual_learner"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserOut(BaseModel):
    id: str
    display_name: str
    email: str | None = None
    role: str
    xp: int
    level: int
    streak_days: int
    last_active_date: str | None = None

    model_config = {"from_attributes": True}


# Fix forward reference — AuthResponse references UserOut which is defined after it.
AuthResponse.model_rebuild()


# ── POST /api/auth/register ─────────────────────────────────────────────────


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    # Check if email already taken
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
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
        xp=0,
        level=1,
        streak_days=0,
    )
    db.add(user)
    await db.flush()

    token = create_access_token(user_id)
    return AuthResponse(
        access_token=token,
        user=UserOut.model_validate(user),
    )


# ── POST /api/auth/login ────────────────────────────────────────────────────


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or user.hashed_password is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_access_token(user.id)
    return AuthResponse(
        access_token=token,
        user=UserOut.model_validate(user),
    )
