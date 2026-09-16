"""Topic and frontier endpoints."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
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


# ── Request / response schemas for topic CRUD ─────────────────────────────────


class TopicCreateRequest(BaseModel):
    workspace_id: int
    title: str = Field(..., min_length=1)
    summary: str | None = None
    prerequisite_ids: list[str] = Field(default_factory=list)


class TopicUpdateRequest(BaseModel):
    title: str | None = None
    summary: str | None = None


class PrerequisiteAddRequest(BaseModel):
    prerequisite_id: str


# ── helpers ────────────────────────────────────────────────────────────────────


def _slugify(title: str) -> str:
    """Convert a title to a URL-friendly slug."""
    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug


async def would_create_cycle(
    db: AsyncSession, topic_id: str, new_prerequisite_id: str
) -> bool:
    """Return True if adding new_prerequisite_id as a prerequisite of topic_id would create a cycle.

    DFS from new_prerequisite_id: follow all prerequisite edges
    (TopicPrerequisite where topic_id = current node).  If we reach topic_id,
    there is a cycle.
    """
    if topic_id == new_prerequisite_id:
        return True

    visited: set[str] = set()
    stack = [new_prerequisite_id]

    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)

        result = await db.execute(
            select(TopicPrerequisite.prerequisite_id).where(
                TopicPrerequisite.topic_id == current
            )
        )
        for (prereq_id,) in result.all():
            if prereq_id == topic_id:
                return True
            if prereq_id not in visited:
                stack.append(prereq_id)

    return False


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


# ── POST /api/topics ─────────────────────────────────────────────────────────


@router.post("/topics", response_model=TopicSummary, status_code=201)
async def create_topic(
    body: TopicCreateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicSummary:
    """Create a new topic with optional prerequisite edges."""
    slug = _slugify(body.title)
    topic_id = f"top_{slug}"

    # Check slug uniqueness
    existing = (
        await db.execute(select(Topic).where(Topic.slug == slug))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Topic with slug '{slug}' already exists")

    topic = Topic(
        id=topic_id,
        workspace_id=body.workspace_id,
        slug=slug,
        title=body.title,
        summary=body.summary,
    )
    db.add(topic)
    await db.flush()

    # Add prerequisite edges with cycle detection
    for prereq_id in body.prerequisite_ids:
        prereq = await db.get(Topic, prereq_id)
        if prereq is None:
            raise HTTPException(status_code=404, detail=f"Prerequisite topic '{prereq_id}' not found")
        if await would_create_cycle(db, topic_id, prereq_id):
            raise HTTPException(
                status_code=400,
                detail=f"Adding prerequisite '{prereq_id}' would create a cycle",
            )
        db.add(TopicPrerequisite(topic_id=topic_id, prerequisite_id=prereq_id))

    await db.flush()
    return TopicSummary(id=topic.id, slug=topic.slug, title=topic.title, summary=topic.summary)


# ── PUT /api/topics/{topic_id} ───────────────────────────────────────────────


@router.put("/topics/{topic_id}", response_model=TopicSummary)
async def update_topic(
    topic_id: str,
    body: TopicUpdateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicSummary:
    """Update a topic's title and/or summary."""
    topic = await db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    if body.title is not None:
        topic.title = body.title
    if body.summary is not None:
        topic.summary = body.summary

    await db.flush()
    return TopicSummary(id=topic.id, slug=topic.slug, title=topic.title, summary=topic.summary)


# ── DELETE /api/topics/{topic_id} ────────────────────────────────────────────


@router.delete("/topics/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a topic. Claims cascade via FK."""
    topic = await db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    await db.delete(topic)
    await db.flush()
    return Response(status_code=204)


# ── POST /api/topics/{topic_id}/prerequisites ────────────────────────────────


@router.post("/topics/{topic_id}/prerequisites", status_code=201)
async def add_prerequisite(
    topic_id: str,
    body: PrerequisiteAddRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a prerequisite edge to a topic (with cycle detection)."""
    topic = await db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    prereq = await db.get(Topic, body.prerequisite_id)
    if prereq is None:
        raise HTTPException(status_code=404, detail=f"Prerequisite topic '{body.prerequisite_id}' not found")

    # Check if edge already exists
    existing = (
        await db.execute(
            select(TopicPrerequisite).where(
                TopicPrerequisite.topic_id == topic_id,
                TopicPrerequisite.prerequisite_id == body.prerequisite_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Prerequisite edge already exists")

    if await would_create_cycle(db, topic_id, body.prerequisite_id):
        raise HTTPException(
            status_code=400,
            detail="Adding this prerequisite would create a cycle in the topic DAG",
        )

    db.add(TopicPrerequisite(topic_id=topic_id, prerequisite_id=body.prerequisite_id))
    await db.flush()
    return {"topic_id": topic_id, "prerequisite_id": body.prerequisite_id}


# ── DELETE /api/topics/{topic_id}/prerequisites/{prerequisite_id} ────────────


@router.delete("/topics/{topic_id}/prerequisites/{prerequisite_id}", status_code=204)
async def remove_prerequisite(
    topic_id: str,
    prerequisite_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove a prerequisite edge."""
    result = await db.execute(
        delete(TopicPrerequisite).where(
            TopicPrerequisite.topic_id == topic_id,
            TopicPrerequisite.prerequisite_id == prerequisite_id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Prerequisite edge not found")
    await db.flush()
    return Response(status_code=204)
