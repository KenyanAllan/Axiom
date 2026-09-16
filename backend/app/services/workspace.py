"""Workspace management — CRUD for personal and classroom-shared workspaces.

Implements domain rules spec section 8.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tables import (
    Activity,
    ClassroomStudent,
    Topic,
    Workspace,
)

logger = logging.getLogger(__name__)


async def create_workspace(
    db: AsyncSession,
    user_id: str,
    title: str,
    description: Optional[str] = None,
) -> Workspace:
    """Create a personal workspace (spec 8.2)."""
    workspace = Workspace(
        user_id=user_id,
        title=title,
        description=description,
        is_classroom_shared=False,
    )
    db.add(workspace)
    await db.flush()
    return workspace


async def get_user_workspaces(
    db: AsyncSession,
    user_id: str,
) -> list[Workspace]:
    """List all workspaces the user can access (spec 8.1-8.2).

    Includes:
    - Personal workspaces owned by the user.
    - Classroom shared workspaces the user is enrolled in as a student.
    """
    # Personal workspaces
    personal_result = await db.execute(
        select(Workspace).where(
            Workspace.user_id == user_id,
            Workspace.is_classroom_shared == False,  # noqa: E712
        )
    )
    personal = list(personal_result.scalars().all())

    # Teacher-owned shared workspaces
    teacher_shared_result = await db.execute(
        select(Workspace).where(
            Workspace.user_id == user_id,
            Workspace.is_classroom_shared == True,  # noqa: E712
        )
    )
    teacher_shared = list(teacher_shared_result.scalars().all())

    # Classroom shared workspaces where user is an enrolled student
    enrolled_classrooms = await db.execute(
        select(ClassroomStudent.classroom_id).where(
            ClassroomStudent.student_id == user_id
        )
    )
    classroom_ids = [row[0] for row in enrolled_classrooms.all()]

    student_shared: list[Workspace] = []
    if classroom_ids:
        student_shared_result = await db.execute(
            select(Workspace).where(
                Workspace.classroom_id.in_(classroom_ids),
                Workspace.is_classroom_shared == True,  # noqa: E712
            )
        )
        student_shared = list(student_shared_result.scalars().all())

    # Deduplicate (teacher might also own the shared workspace)
    seen_ids: set[int] = set()
    combined: list[Workspace] = []
    for ws in personal + teacher_shared + student_shared:
        if ws.id not in seen_ids:
            seen_ids.add(ws.id)
            combined.append(ws)

    return combined


async def get_workspace_detail(
    db: AsyncSession,
    workspace_id: int,
    user_id: str,
) -> dict:
    """Return workspace with topic_count and activity_count.

    Validates that the user has access to the workspace.
    """
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise ValueError("Workspace not found")

    # Access check: owner, or enrolled student in the classroom
    has_access = workspace.user_id == user_id
    if not has_access and workspace.classroom_id is not None:
        enrollment = (
            await db.execute(
                select(ClassroomStudent).where(
                    ClassroomStudent.classroom_id == workspace.classroom_id,
                    ClassroomStudent.student_id == user_id,
                )
            )
        ).scalar_one_or_none()
        has_access = enrollment is not None

    if not has_access:
        raise ValueError("Access denied to this workspace")

    # Count topics
    topic_count_result = await db.execute(
        select(func.count()).select_from(Topic).where(
            Topic.workspace_id == workspace_id
        )
    )
    topic_count = topic_count_result.scalar() or 0

    # Count activities
    activity_count_result = await db.execute(
        select(func.count()).select_from(Activity).where(
            Activity.workspace_id == workspace_id
        )
    )
    activity_count = activity_count_result.scalar() or 0

    return {
        "id": workspace.id,
        "user_id": workspace.user_id,
        "classroom_id": workspace.classroom_id,
        "title": workspace.title,
        "description": workspace.description,
        "is_classroom_shared": workspace.is_classroom_shared,
        "created_at": workspace.created_at.isoformat() if workspace.created_at else None,
        "topic_count": topic_count,
        "activity_count": activity_count,
    }


async def delete_workspace(
    db: AsyncSession,
    workspace_id: int,
    user_id: str,
) -> bool:
    """Delete a personal workspace (spec 8.2).

    Cannot delete classroom shared workspaces — they are managed by
    the classroom lifecycle.

    Returns True on success.
    Raises ValueError if not found, not owned, or is classroom shared.
    """
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise ValueError("Workspace not found")

    if workspace.user_id != user_id:
        raise PermissionError("Access denied — you do not own this workspace")

    if workspace.is_classroom_shared:
        raise PermissionError("Cannot delete a classroom shared workspace")

    await db.delete(workspace)
    await db.flush()
    return True
