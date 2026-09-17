"""Shared API dependency helpers."""

from __future__ import annotations

import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Classroom, ClassroomStudent, Topic, Workspace

logger = logging.getLogger(__name__)


async def resolve_topic(db: AsyncSession, id_or_slug: str) -> Topic | None:
    """Resolve a topic by primary key or slug fallback."""
    topic = await db.get(Topic, id_or_slug)
    if topic is not None:
        return topic
    result = await db.execute(select(Topic).where(Topic.slug == id_or_slug))
    return result.scalar_one_or_none()


async def verify_workspace_access(
    db: AsyncSession, workspace_id: int, user_id: str
) -> Workspace:
    """Verify that a user has access to a workspace.

    Access is granted if:
      - The user owns the workspace, OR
      - The workspace belongs to a classroom where the user is the teacher, OR
      - The workspace belongs to a classroom where the user is enrolled as a student.

    Raises HTTPException 404 if workspace not found, 403 if access denied.
    Returns the workspace on success.
    """
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Owner check
    if workspace.user_id == user_id:
        return workspace

    # Classroom membership check
    if workspace.classroom_id is not None:
        classroom = await db.get(Classroom, workspace.classroom_id)
        if classroom and classroom.teacher_id == user_id:
            return workspace
        enrolled = await db.execute(
            select(ClassroomStudent).where(
                ClassroomStudent.classroom_id == workspace.classroom_id,
                ClassroomStudent.student_id == user_id,
            )
        )
        if enrolled.scalar_one_or_none() is not None:
            return workspace

    raise HTTPException(status_code=403, detail="Access denied to this workspace")


async def get_user_workspace_ids(db: AsyncSession, user_id: str) -> list[int]:
    """Return all workspace IDs a user has access to.

    Includes workspaces owned by the user, workspaces in classrooms they teach,
    and workspaces in classrooms they are enrolled in.
    """
    # Owned workspaces
    owned = await db.execute(
        select(Workspace.id).where(Workspace.user_id == user_id)
    )
    ws_ids = {row[0] for row in owned.all()}

    # Workspaces in classrooms where user is teacher
    teacher_ws = await db.execute(
        select(Workspace.id)
        .join(Classroom, Workspace.classroom_id == Classroom.id)
        .where(Classroom.teacher_id == user_id)
    )
    ws_ids |= {row[0] for row in teacher_ws.all()}

    # Workspaces in classrooms where user is enrolled
    enrolled_ws = await db.execute(
        select(Workspace.id)
        .join(Classroom, Workspace.classroom_id == Classroom.id)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .where(ClassroomStudent.student_id == user_id)
    )
    ws_ids |= {row[0] for row in enrolled_ws.all()}

    return list(ws_ids)
