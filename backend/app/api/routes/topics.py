"""Topic and frontier endpoints."""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_topic, verify_workspace_access, get_user_workspace_ids
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

logger = logging.getLogger(__name__)

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


_resolve_topic = resolve_topic


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


# ── GET /api/topics ─────────────────────────────────────────────────────────


@router.get("/topics", response_model=list[TopicSummary])
async def list_topics(
    workspace_id: int = Query(..., description="Filter by workspace ID"),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TopicSummary]:
    """List all topics in a workspace."""
    await verify_workspace_access(db, workspace_id, user_id)
    stmt = (
        select(Topic)
        .where(Topic.workspace_id == workspace_id)
        .order_by(Topic.title)
    )
    result = await db.execute(stmt)
    topics = result.scalars().all()
    logger.debug("Listed topics: workspace_id=%d, count=%d", workspace_id, len(topics))
    return [
        TopicSummary(id=t.id, slug=t.slug, title=t.title, summary=t.summary)
        for t in topics
    ]


# ── GET /api/topics/{slug} ──────────────────────────────────────────────────


@router.get("/topics/{slug}", response_model=TopicDetailResponse)
async def get_topic(
    slug: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TopicDetailResponse:
    """Return topic content, claims, and prerequisite mastery status."""
    topic = await _resolve_topic(db, slug)
    if topic is None:
        logger.warning("Topic not found: slug=%s", slug)
        raise HTTPException(status_code=404, detail=f"Topic '{slug}' not found")

    if topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

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

    logger.debug("Fetched topic detail: slug=%s, claims=%d", slug, len(claims))
    return TopicDetailResponse(
        topic=TopicSummary(
            id=topic.id, slug=topic.slug, title=topic.title, summary=topic.summary
        ),
        claims=claims,
        prerequisites=prerequisites,
        prerequisite_mastery=prereq_mastery,
    )


# ── GET /api/frontier ───────────────────────────────────────────────────────

_FRONTIER_CTE_TEMPLATE = """
WITH topic_claim_counts AS (
    SELECT
        t.id AS topic_id,
        t.slug,
        t.title,
        COUNT(ac.id) AS claim_count,
        COALESCE(SUM(CASE WHEN um.status = 'mastered' THEN 1 ELSE 0 END), 0) AS mastered_count
    FROM topics t
    LEFT JOIN atomic_claims ac ON ac.topic_id = t.id
    LEFT JOIN user_mastery um
        ON um.claim_id = ac.id AND um.user_id = :user_id
    {workspace_filter}
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
    WHERE tc.mastered_count < tc.claim_count
      AND NOT EXISTS (
          SELECT 1
          FROM topic_prerequisites tp
          WHERE tp.topic_id = tc.topic_id
            AND tp.prerequisite_id NOT IN (SELECT topic_id FROM fully_mastered_topics)
      )
)
SELECT topic_id, slug, title, claim_count, mastered_count
FROM frontier
ORDER BY mastered_count DESC, title ASC
"""


@router.get("/frontier", response_model=FrontierResponse)
async def get_frontier(
    workspace_id: int | None = Query(None, description="Filter by workspace"),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FrontierResponse:
    """Return the student's learning frontier via recursive CTE.

    A topic is on the frontier when:
      - It is NOT fully mastered, AND
      - ALL of its prerequisite topics ARE fully mastered (or it has none).
    """
    params: dict = {"user_id": user_id}
    if workspace_id is not None:
        await verify_workspace_access(db, workspace_id, user_id)
        ws_filter = "WHERE t.workspace_id = :workspace_id"
        params["workspace_id"] = workspace_id
    else:
        # Scope to user's accessible workspaces
        user_ws_ids = await get_user_workspace_ids(db, user_id)
        if user_ws_ids:
            ws_filter = "WHERE t.workspace_id IN :workspace_ids"
            params["workspace_ids"] = tuple(user_ws_ids)
        else:
            ws_filter = "WHERE 1=0"  # no accessible workspaces
    sql = text(_FRONTIER_CTE_TEMPLATE.format(workspace_filter=ws_filter))
    rows = (await db.execute(sql, params)).all()

    logger.debug("Fetched frontier: user_id=%s, topics=%d", user_id, len(rows))
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
    await verify_workspace_access(db, body.workspace_id, user_id)
    slug = _slugify(body.title)
    if not slug:
        raise HTTPException(status_code=400, detail="Title must contain at least one alphanumeric character")
    topic_id = f"top_{slug}"

    # Check slug and PK uniqueness
    existing = (
        await db.execute(select(Topic).where((Topic.slug == slug) | (Topic.id == topic_id)))
    ).scalar_one_or_none()
    if existing is not None:
        logger.warning("Duplicate topic slug: slug=%s", slug)
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

    # Add prerequisite edges (deduplicated, with self-loop guard)
    seen_prereq_ids: set[str] = set()
    for prereq_id in body.prerequisite_ids:
        prereq = await _resolve_topic(db, prereq_id)
        if prereq is None:
            logger.warning("Prerequisite not found: prereq_id=%s", prereq_id)
            raise HTTPException(status_code=404, detail=f"Prerequisite topic '{prereq_id}' not found")
        if prereq.id == topic_id:
            raise HTTPException(status_code=400, detail=f"A topic cannot be its own prerequisite")
        if prereq.id in seen_prereq_ids:
            continue
        seen_prereq_ids.add(prereq.id)
        db.add(TopicPrerequisite(topic_id=topic_id, prerequisite_id=prereq.id))

    await db.flush()
    logger.info("Created topic: topic_id=%s, title=%s", topic.id, topic.title)
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
    topic = await _resolve_topic(db, topic_id)
    if topic is None:
        logger.warning("Topic not found for update: topic_id=%s", topic_id)
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    if topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

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
    topic = await _resolve_topic(db, topic_id)
    if topic is None:
        logger.warning("Topic not found for deletion: topic_id=%s", topic_id)
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    if topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

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
    topic = await _resolve_topic(db, topic_id)
    if topic is None:
        logger.warning("Topic not found for prerequisite add: topic_id=%s", topic_id)
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    if topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

    prereq = await _resolve_topic(db, body.prerequisite_id)
    if prereq is None:
        logger.warning("Prerequisite topic not found: prerequisite_id=%s", body.prerequisite_id)
        raise HTTPException(status_code=404, detail=f"Prerequisite topic '{body.prerequisite_id}' not found")

    # Check if edge already exists
    existing = (
        await db.execute(
            select(TopicPrerequisite).where(
                TopicPrerequisite.topic_id == topic.id,
                TopicPrerequisite.prerequisite_id == prereq.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        logger.warning("Duplicate prerequisite edge: topic_id=%s, prereq_id=%s", topic.id, prereq.id)
        raise HTTPException(status_code=409, detail="Prerequisite edge already exists")

    if await would_create_cycle(db, topic.id, prereq.id):
        logger.warning("Cycle detected in DAG: topic_id=%s, prereq_id=%s", topic.id, prereq.id)
        raise HTTPException(
            status_code=400,
            detail="Adding this prerequisite would create a cycle in the topic DAG",
        )

    db.add(TopicPrerequisite(topic_id=topic.id, prerequisite_id=prereq.id))
    await db.flush()
    return {"topic_id": topic.id, "prerequisite_id": prereq.id}


# ── DELETE /api/topics/{topic_id}/prerequisites/{prerequisite_id} ────────────


@router.delete("/topics/{topic_id}/prerequisites/{prerequisite_id}", status_code=204)
async def remove_prerequisite(
    topic_id: str,
    prerequisite_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove a prerequisite edge."""
    topic = await _resolve_topic(db, topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    if topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

    prereq = await _resolve_topic(db, prerequisite_id)
    resolved_prereq_id = prereq.id if prereq else prerequisite_id
    result = await db.execute(
        delete(TopicPrerequisite).where(
            TopicPrerequisite.topic_id == topic.id,
            TopicPrerequisite.prerequisite_id == resolved_prereq_id,
        )
    )
    if result.rowcount == 0:
        logger.warning("Prerequisite edge not found: topic_id=%s, prereq_id=%s", topic_id, prerequisite_id)
        raise HTTPException(status_code=404, detail="Prerequisite edge not found")
    await db.flush()
    return Response(status_code=204)
