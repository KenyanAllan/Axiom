"""Classroom endpoints — create, join, list, diagnostic, broadcast."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import (
    Classroom,
    ClassroomStudent,
    User,
    UserMastery,
    ActivityAttempt,
    Activity,
)
from app.schemas.classrooms import (
    ClassroomCreate,
    ClassroomResponse,
    ClassroomDetail,
    JoinRequest,
    JoinResponse,
    ClassroomDiagnosticResponse,
    AssignActivityRequest,
    StudentSummary,
)
from app.services.classroom import (
    create_classroom,
    join_classroom,
    get_classroom_detail,
    get_diagnostic,
    get_student_progress,
    broadcast_activity_to_class,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/classrooms", tags=["classrooms"])


# ── helpers ────────────────────────────────────────────────────────────────────


async def _require_teacher(user_id: str, db: AsyncSession) -> User:
    """Return the User row and raise 403 if not a teacher."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can perform this action")
    return user


async def _require_student(user_id: str, db: AsyncSession) -> User:
    """Return the User row and raise 403 if not a student."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can join classrooms")
    return user


# ── POST /api/classrooms ──────────────────────────────────────────────────────


@router.post("", response_model=ClassroomResponse, status_code=201)
async def create_classroom_endpoint(
    body: ClassroomCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClassroomResponse:
    """Create a new classroom (teacher only)."""
    await _require_teacher(user_id, db)
    result = await create_classroom(db=db, teacher_id=user_id, title=body.title)
    return result


# ── POST /api/classrooms/join ─────────────────────────────────────────────────


@router.post("/join", response_model=JoinResponse)
async def join_classroom_endpoint(
    body: JoinRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JoinResponse:
    """Join a classroom by code (student only)."""
    await _require_student(user_id, db)
    try:
        result = await join_classroom(db=db, student_id=user_id, join_code=body.join_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


# ── GET /api/classrooms ───────────────────────────────────────────────────────


@router.get("", response_model=list[ClassroomResponse])
async def list_classrooms(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ClassroomResponse]:
    """List classrooms. Teachers see their created classrooms; students see enrolled ones."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "teacher":
        stmt = select(Classroom).where(Classroom.teacher_id == user_id)
    else:
        # Student: find classrooms they are enrolled in
        stmt = (
            select(Classroom)
            .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
            .where(ClassroomStudent.student_id == user_id)
        )

    rows = (await db.execute(stmt)).scalars().all()

    results: list[ClassroomResponse] = []
    for c in rows:
        count_stmt = (
            select(func.count())
            .select_from(ClassroomStudent)
            .where(ClassroomStudent.classroom_id == c.id)
        )
        student_count = (await db.execute(count_stmt)).scalar_one()
        results.append(
            ClassroomResponse(
                id=c.id,
                teacher_id=c.teacher_id,
                title=c.title,
                join_code=c.join_code,
                created_at=c.created_at,
                student_count=student_count,
            )
        )

    return results


# ── GET /api/classrooms/{id} ──────────────────────────────────────────────────


@router.get("/{classroom_id}", response_model=ClassroomDetail)
async def get_classroom(
    classroom_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClassroomDetail:
    """Get classroom detail with student list (teacher only)."""
    await _require_teacher(user_id, db)
    try:
        result = await get_classroom_detail(db=db, classroom_id=classroom_id, teacher_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return result


# ── GET /api/classrooms/{id}/diagnostic ───────────────────────────────────────


@router.get("/{classroom_id}/diagnostic", response_model=ClassroomDiagnosticResponse)
async def classroom_diagnostic(
    classroom_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClassroomDiagnosticResponse:
    """Get mastery heatmap for the classroom (teacher only)."""
    await _require_teacher(user_id, db)
    try:
        result = await get_diagnostic(db=db, teacher_id=user_id, classroom_id=classroom_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return result


# ── GET /api/classrooms/{id}/students/{student_id}/progress ───────────────────


@router.get("/{classroom_id}/students/{student_id}/progress")
async def student_progress(
    classroom_id: int,
    student_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get individual student progress — activity history and mastery data (teacher only)."""
    await _require_teacher(user_id, db)
    try:
        result = await get_student_progress(
            db=db, teacher_id=user_id, student_id=student_id, classroom_id=classroom_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return result


# ── POST /api/classrooms/{id}/broadcast ───────────────────────────────────────


@router.post("/{classroom_id}/broadcast", status_code=200)
async def broadcast_activity(
    classroom_id: int,
    body: AssignActivityRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Broadcast an activity to all students in the classroom (teacher only)."""
    await _require_teacher(user_id, db)
    try:
        await broadcast_activity_to_class(
            db=db,
            classroom_id=classroom_id,
            activity_id=body.activity_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "broadcast", "activity_id": body.activity_id}
