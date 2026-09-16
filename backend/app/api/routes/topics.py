"""Topic and frontier endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import AtomicClaim, Topic, TopicPrerequisite, UserMastery
from app.schemas.activities import (
    ClaimDetail,
    FrontierResponse,
    FrontierTopic,
    TopicDetailResponse,
    TopicSummary,
)

router = APIRouter(prefix="/api", tags=["topics"])


# ── GET /api/topics/{slug} ──────────────────────────────────────────────────


@router.get("/topics/{slug}", response_model=TopicDetailResponse)
async def get_topic(
    slug: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicDetailResponse:
    """Return topic content, claims, and prerequisite mastery status."""
    stmt = select(Topic).where(Topic.slug == slug)
    topic = (await db.execute(stmt)).scalar_one_or_none()
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{slug}' not found")

    # Claims
    claims = [
        ClaimDetail(
            id=c.id,
            title=c.title,
            content=c.content,
            diagnostic_prompt=c.diagnostic_prompt,
            flawed_snippet=c.flawed_snippet,
            rubric=c.rubric,
        )
        for c in topic.claims
    ]

    # Prerequisites
    prerequisites = [
        TopicSummary(id=p.id, slug=p.slug, title=p.title, summary=p.summary)
        for p in topic.prerequisites
    ]

    # Prerequisite mastery: a prerequisite topic is "mastered" when ALL its
    # claims have user_mastery.status = 'mastered' for this user.
    prereq_mastery: dict[str, bool] = {}
    for p in topic.prerequisites:
        if not p.claims:
            prereq_mastery[p.id] = True
            continue
        mastery_stmt = (
            select(func.count())
            .select_from(UserMastery)
            .where(
                UserMastery.user_id == user_id,
                UserMastery.claim_id.in_([c.id for c in p.claims]),
                UserMastery.status == "mastered",
            )
        )
        mastered_count = (await db.execute(mastery_stmt)).scalar_one()
        prereq_mastery[p.id] = mastered_count == len(p.claims)

    return TopicDetailResponse(
        topic=TopicSummary(
            id=topic.id, slug=topic.slug, title=topic.title, summary=topic.summary
        ),
        claims=claims,
        prerequisites=prerequisites,
        prerequisite_mastery=prereq_mastery,
    )


# ── GET /api/frontier ───────────────────────────────────────────────────────

FRONTIER_CTE_SQL = text("""
WITH topic_claim_counts AS (
    SELECT
        t.id AS topic_id,
        t.slug,
        t.title,
        COUNT(ac.id)::int AS claim_count,
        COUNT(um.claim_id) FILTER (WHERE um.status = 'mastered')::int AS mastered_count
    FROM topics t
    LEFT JOIN atomic_claims ac ON ac.topic_id = t.id
    LEFT JOIN user_mastery um
        ON um.claim_id = ac.id AND um.user_id = :user_id
    GROUP BY t.id, t.slug, t.title
),
fully_mastered_topics AS (
    SELECT topic_id
    FROM topic_claim_counts
    WHERE claim_count > 0 AND mastered_count = claim_count
),
frontier AS (
    SELECT tc.*
    FROM topic_claim_counts tc
    WHERE tc.mastered_count < tc.claim_count     -- not fully mastered
      AND NOT EXISTS (                           -- all prereqs are mastered
          SELECT 1
          FROM topic_prerequisites tp
          WHERE tp.topic_id = tc.topic_id
            AND tp.prerequisite_id NOT IN (SELECT topic_id FROM fully_mastered_topics)
      )
)
SELECT topic_id, slug, title, claim_count, mastered_count
FROM frontier
ORDER BY mastered_count DESC, title ASC
""")


@router.get("/frontier", response_model=FrontierResponse)
async def get_frontier(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FrontierResponse:
    """Return the student's learning frontier via recursive CTE.

    A topic is on the frontier when:
      - It is NOT fully mastered, AND
      - ALL of its prerequisite topics ARE fully mastered (or it has none).
    """
    rows = (await db.execute(FRONTIER_CTE_SQL, {"user_id": user_id})).all()

    return FrontierResponse(
        frontier=[
            FrontierTopic(
                topic_id=r.topic_id,
                slug=r.slug,
                title=r.title,
                claim_count=r.claim_count,
                mastered_count=r.mastered_count,
            )
            for r in rows
        ]
    )
