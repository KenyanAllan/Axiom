"""Classroom endpoints — create, join, list, diagnostic, broadcast."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.models.tables import (
    Classroom,
    ClassroomStudent,
    ChatSession,
    ChatMessage,
    User,
    Workspace,
)
from app.schemas.classrooms import (
    ClassroomCreate,
    ClassroomResponse,
    ClassroomDetail,
    JoinRequest,
    JoinResponse,
    ClassroomDiagnosticResponse,
    AssignActivityRequest,
    LeaderboardEntry,
    StudentSummary,
)
from app.services.classroom import (
    create_classroom,
    join_classroom,
    get_classroom_detail,
    get_diagnostic,
    get_student_progress,
    get_classroom_activity_history,
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
        logger.warning("Non-teacher attempted teacher action: user_id=%s, role=%s", user_id, user.role)
        raise HTTPException(status_code=403, detail="Only teachers can perform this action")
    return user


async def _require_student(user_id: str, db: AsyncSession) -> User:
    """Return the User row and raise 403 if not a student."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "student":
        logger.warning("Non-student attempted join: user_id=%s, role=%s", user_id, user.role)
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
    logger.info("Created classroom: classroom_id=%s, teacher_id=%s", result.id, user_id)
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
        logger.warning("Join classroom failed: student_id=%s, join_code=%s, error=%s", user_id, body.join_code, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    logger.info("Student joined classroom: student_id=%s, classroom_id=%s", user_id, result.classroom_id)
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
        logger.warning("User not found for classroom list: user_id=%s", user_id)
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

    from sqlalchemy.orm import selectinload

    stmt = stmt.options(selectinload(Classroom.enrollments))
    rows = (await db.execute(stmt)).scalars().all()

    return [
        ClassroomResponse(
            id=c.id,
            teacher_id=c.teacher_id,
            title=c.title,
            join_code=c.join_code,
            created_at=c.created_at,
            student_count=len(c.enrollments or []),
        )
        for c in rows
    ]


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
        logger.warning("Classroom detail fetch failed: classroom_id=%d, error=%s", classroom_id, exc)
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
        logger.warning("Classroom diagnostic failed: classroom_id=%d, error=%s", classroom_id, exc)
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
        logger.warning("Student progress fetch failed: student_id=%s, classroom_id=%d, error=%s", student_id, classroom_id, exc)
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
        logger.warning("Broadcast failed: classroom_id=%d, activity_id=%s, error=%s", classroom_id, body.activity_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "broadcast", "activity_id": body.activity_id}


# ── GET /api/classrooms/{id}/activity-history ────────────────────────────────


@router.get("/{classroom_id}/activity-history")
async def classroom_activity_history(
    classroom_id: int,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get chronological activity history for all students in a classroom (teacher only)."""
    await _require_teacher(user_id, db)
    try:
        result = await get_classroom_activity_history(
            db=db, teacher_id=user_id, classroom_id=classroom_id,
            limit=limit, offset=offset,
        )
    except ValueError as exc:
        logger.warning("Activity history fetch failed: classroom_id=%d, error=%s", classroom_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    return result


# ── GET /api/classrooms/{id}/leaderboard ─────────────────────────────────────


@router.get("/{classroom_id}/leaderboard", response_model=list[LeaderboardEntry])
async def classroom_leaderboard(
    classroom_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[LeaderboardEntry]:
    """Get XP leaderboard for a classroom. Accessible by the teacher or any enrolled student."""
    # Check classroom exists
    classroom = await db.get(Classroom, classroom_id)
    if classroom is None:
        logger.warning("Classroom not found for leaderboard: classroom_id=%d", classroom_id)
        raise HTTPException(status_code=404, detail="Classroom not found")

    # Allow teacher OR enrolled student
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "teacher":
        if classroom.teacher_id != user_id:
            logger.warning("Teacher does not own classroom: user_id=%s, classroom_id=%d", user_id, classroom_id)
            raise HTTPException(status_code=403, detail="You do not own this classroom")
    else:
        # Check student is enrolled
        enrollment = (
            await db.execute(
                select(ClassroomStudent).where(
                    ClassroomStudent.classroom_id == classroom_id,
                    ClassroomStudent.student_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if enrollment is None:
            logger.warning("Student not enrolled: student_id=%s, classroom_id=%d", user_id, classroom_id)
            raise HTTPException(status_code=403, detail="You are not enrolled in this classroom")

    # Query enrolled students ordered by XP
    stmt = (
        select(User)
        .join(ClassroomStudent, ClassroomStudent.student_id == User.id)
        .where(ClassroomStudent.classroom_id == classroom_id)
        .order_by(User.xp.desc())
    )
    students = (await db.execute(stmt)).scalars().all()

    return [
        LeaderboardEntry(
            rank=idx + 1,
            student_id=s.id,
            display_name=s.display_name,
            xp=s.xp or 0,
            level=s.level or 1,
        )
        for idx, s in enumerate(students)
    ]


# ── GET /api/classrooms/{id}/chat-history ─────────────────────────────────────


@router.get("/{classroom_id}/chat-history")
async def classroom_chat_history(
    classroom_id: int,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all chat sessions from students in a classroom (teacher only)."""
    await _require_teacher(user_id, db)

    classroom = await db.get(Classroom, classroom_id)
    if classroom is None:
        logger.warning("Classroom not found for chat history: classroom_id=%d", classroom_id)
        raise HTTPException(status_code=404, detail="Classroom not found")
    if classroom.teacher_id != user_id:
        logger.warning("Teacher does not own classroom for chat history: user_id=%s, classroom_id=%d", user_id, classroom_id)
        raise HTTPException(status_code=403, detail="You do not own this classroom")

    msg_count = (
        select(func.count(ChatMessage.id))
        .where(ChatMessage.session_id == ChatSession.id)
        .correlate(ChatSession)
        .scalar_subquery()
    )

    base_filter = (
        select(ChatSession.id)
        .join(Workspace, ChatSession.workspace_id == Workspace.id)
        .where(Workspace.classroom_id == classroom_id)
    )
    total = (await db.execute(select(func.count()).select_from(base_filter.subquery()))).scalar_one()

    stmt = (
        select(ChatSession, User.display_name, msg_count.label("message_count"))
        .join(Workspace, ChatSession.workspace_id == Workspace.id)
        .join(User, ChatSession.user_id == User.id)
        .where(Workspace.classroom_id == classroom_id)
        .order_by(ChatSession.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()

    logger.debug("Fetched chat history: classroom_id=%d, sessions=%d", classroom_id, len(rows))
    return {
        "items": [
            {
                "session_id": row.ChatSession.id,
                "student_name": row.display_name,
                "student_id": row.ChatSession.user_id,
                "title": row.ChatSession.title,
                "message_count": row.message_count or 0,
                "created_at": row.ChatSession.created_at.isoformat() if row.ChatSession.created_at else None,
            }
            for row in rows
        ],
        "total": total,
    }


# ── GET /api/classrooms/{id}/chat-history/{session_id} ───────────────────────


@router.get("/{classroom_id}/chat-history/{session_id}")
async def classroom_chat_session_detail(
    classroom_id: int,
    session_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full conversation for a student chat session (teacher only)."""
    await _require_teacher(user_id, db)

    classroom = await db.get(Classroom, classroom_id)
    if classroom is None:
        logger.warning("Classroom not found for session detail: classroom_id=%d", classroom_id)
        raise HTTPException(status_code=404, detail="Classroom not found")
    if classroom.teacher_id != user_id:
        logger.warning("Teacher does not own classroom for session detail: user_id=%s, classroom_id=%d", user_id, classroom_id)
        raise HTTPException(status_code=403, detail="You do not own this classroom")

    stmt = (
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .join(Workspace, ChatSession.workspace_id == Workspace.id)
        .where(
            ChatSession.id == session_id,
            Workspace.classroom_id == classroom_id,
        )
    )
    session = (await db.execute(stmt)).scalar_one_or_none()
    if session is None:
        logger.warning("Chat session not found: session_id=%d, classroom_id=%d", session_id, classroom_id)
        raise HTTPException(status_code=404, detail="Chat session not found")

    student = await db.get(User, session.user_id)

    logger.debug("Fetched chat session detail: session_id=%d, classroom_id=%d", session_id, classroom_id)
    return {
        "session_id": session.id,
        "student_name": student.display_name if student else "Unknown",
        "student_id": session.user_id,
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in session.messages
        ],
    }
