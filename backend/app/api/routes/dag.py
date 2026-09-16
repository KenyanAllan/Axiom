"""DAG endpoints — workspace topic graph stats, frontier, topological order."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.services.dag import (
    add_prerequisite_safe,
    compute_frontier,
    get_dag_stats,
    topological_sort,
)

router = APIRouter(prefix="/api/dag", tags=["dag"])


class PrerequisiteRequest(BaseModel):
    topic_id: str
    prerequisite_id: str


class FrontierItem(BaseModel):
    topic_id: str
    slug: str | None
    title: str | None
    claim_count: int
    mastered_count: int


class TopicOrderItem(BaseModel):
    id: str
    title: str | None


class DagStatsResponse(BaseModel):
    workspace_id: int
    topic_count: int
    edge_count: int
    root_count: int
    leaf_count: int
    topological_order: list[TopicOrderItem]


@router.get("/stats/{workspace_id}", response_model=DagStatsResponse)
async def dag_stats(
    workspace_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DagStatsResponse:
    """Get DAG summary stats for a workspace."""
    stats = await get_dag_stats(db, workspace_id)
    return DagStatsResponse(**stats)


@router.get("/frontier", response_model=list[FrontierItem])
async def frontier(
    workspace_id: int | None = None,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FrontierItem]:
    """Get the user's learning frontier — next topics to study."""
    items = await compute_frontier(db, user_id, workspace_id)
    return [FrontierItem(**item) for item in items]


@router.get("/order/{workspace_id}", response_model=list[TopicOrderItem])
async def topological_order(
    workspace_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TopicOrderItem]:
    """Get topics in prerequisite-first topological order."""
    topics = await topological_sort(db, workspace_id)
    return [TopicOrderItem(id=t.id, title=t.title) for t in topics]


@router.post("/prerequisites", status_code=201)
async def add_prerequisite(
    body: PrerequisiteRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a prerequisite edge between two topics (with cycle detection)."""
    added = await add_prerequisite_safe(db, body.topic_id, body.prerequisite_id)
    if not added:
        raise HTTPException(
            status_code=409,
            detail="Edge already exists or would create a cycle",
        )
    await db.commit()
    return {"status": "added", "topic_id": body.topic_id, "prerequisite_id": body.prerequisite_id}
