"""User profile endpoints — me, mastery, history."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import ActivityAttempt, AtomicClaim, Topic, User, UserMastery
from app.schemas.activities import HistoryEvent, MasteryEntry, UserProfile

router = APIRouter(prefix="/api/users", tags=["users"])


# ── GET /api/users/me ────────────────────────────────────────────────────────


@router.get("/me", response_model=UserProfile)
async def get_me(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return UserProfile(
        id=user.id,
        display_name=user.display_name,
        role=user.role,
        xp=user.xp,
        level=user.level,
        streak_days=user.streak_days,
        last_active_date=user.last_active_date,
        email=user.email,
    )


# ── GET /api/users/me/mastery ────────────────────────────────────────────────


@router.get("/me/mastery", response_model=list[MasteryEntry])
async def get_my_mastery(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MasteryEntry]:
    stmt = (
        select(UserMastery, AtomicClaim.title, Topic.title)
        .join(AtomicClaim, UserMastery.claim_id == AtomicClaim.id)
        .join(Topic, AtomicClaim.topic_id == Topic.id)
        .where(UserMastery.user_id == user_id)
        .order_by(UserMastery.updated_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        MasteryEntry(
            claim_id=mastery.claim_id,
            claim_title=claim_title,
            topic_title=topic_title,
            status=mastery.status,
            understanding_rating=mastery.understanding_rating,
            updated_at=mastery.updated_at,
        )
        for mastery, claim_title, topic_title in rows
    ]


# ── GET /api/users/me/history ────────────────────────────────────────────────


@router.get("/me/history", response_model=list[HistoryEvent])
async def get_my_history(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[HistoryEvent]:
    stmt = (
        select(ActivityAttempt, AtomicClaim.title)
        .outerjoin(AtomicClaim, ActivityAttempt.claim_id == AtomicClaim.id)
        .where(ActivityAttempt.user_id == user_id)
        .order_by(ActivityAttempt.attempted_at.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        HistoryEvent(
            claim_id=attempt.claim_id or "",
            claim_title=claim_title or "Unknown",
            is_correct=(attempt.outcome == "understood"),
            xp_awarded=attempt.xp_awarded,
            timestamp=attempt.attempted_at,
        )
        for attempt, claim_title in rows
    ]
