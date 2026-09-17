"""Classroom management — creation, enrollment, diagnostics.

Implements domain rules spec sections 6-7.
"""

from __future__ import annotations

import logging
import secrets
import string
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tables import (
    Activity,
    Classroom,
    ClassroomStudent,
    User,
    UserActivityQueue,
    UserMastery,
    Workspace,
)

logger = logging.getLogger(__name__)


# ── Join Code ─────────────────────────────────────────────────────────────────


def generate_join_code() -> str:
    """Generate a unique 6-character uppercase alphanumeric code (spec 6.1)."""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(6))


# ── Classroom CRUD ────────────────────────────────────────────────────────────


async def create_classroom(
    db: AsyncSession,
    teacher_id: str,
    title: str,
) -> Classroom:
    """Create a classroom with a join_code and auto-provision a shared workspace (spec 6.1, 8.2)."""
    # Generate a unique join code (retry on collision)
    for _ in range(10):
        code = generate_join_code()
        existing = (
            await db.execute(
                select(Classroom).where(Classroom.join_code == code)
            )
        ).scalar_one_or_none()
        if existing is None:
            break
    else:
        raise RuntimeError("Failed to generate unique join code after 10 attempts")

    classroom = Classroom(
        teacher_id=teacher_id,
        title=title,
        join_code=code,
    )
    db.add(classroom)
    await db.flush()
    logger.info("Classroom created: id=%s teacher_id=%s title=%s", classroom.id, teacher_id, title)

    # Auto-provision shared workspace (spec 8.2)
    workspace = Workspace(
        user_id=teacher_id,
        classroom_id=classroom.id,
        title=f"{title} — Shared Workspace",
        is_classroom_shared=True,
    )
    db.add(workspace)
    await db.flush()

    return classroom


# ── Enrollment ────────────────────────────────────────────────────────────────


async def join_classroom(
    db: AsyncSession,
    student_id: str,
    join_code: str,
) -> dict:
    """Validate join code, enroll student, sync active classroom activities (spec 6.2).

    Returns {classroom_id, classroom_title, workspace_id}.
    Raises ValueError on invalid code or duplicate enrollment.
    """
    logger.info("Join classroom: student_id=%s join_code=%s", student_id, join_code)

    # 1. Validate join_code
    result = await db.execute(
        select(Classroom)
        .where(Classroom.join_code == join_code.upper())
        .options(selectinload(Classroom.workspace))
    )
    classroom = result.scalar_one_or_none()
    if classroom is None:
        raise ValueError(f"Invalid join code: {join_code}")

    # 2. Check duplicate enrollment
    existing = (
        await db.execute(
            select(ClassroomStudent).where(
                ClassroomStudent.classroom_id == classroom.id,
                ClassroomStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ValueError("Student is already enrolled in this classroom")

    # 3. Create enrollment
    enrollment = ClassroomStudent(
        classroom_id=classroom.id,
        student_id=student_id,
    )
    db.add(enrollment)
    await db.flush()

    # 4. Sync active CLASSROOM_SHARED activities to student's queue (spec 6.2)
    shared_activities = (
        await db.execute(
            select(Activity).where(
                Activity.classroom_id == classroom.id,
                Activity.scope == "CLASSROOM_SHARED",
            )
        )
    ).scalars().all()

    if shared_activities:
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        values = [
            {"user_id": student_id, "activity_id": activity.id}
            for activity in shared_activities
        ]
        stmt = pg_insert(UserActivityQueue).values(values).on_conflict_do_nothing(
            constraint="uq_user_activity"
        )
        await db.execute(stmt)

    await db.flush()

    workspace = classroom.workspace
    return {
        "classroom_id": classroom.id,
        "classroom_title": classroom.title,
        "workspace_id": workspace.id if workspace else None,
    }


# ── Teacher Views ─────────────────────────────────────────────────────────────


async def get_classroom_detail(
    db: AsyncSession,
    classroom_id: int,
    teacher_id: str,
) -> dict:
    """Return classroom with enrolled students and shared workspace."""
    result = await db.execute(
        select(Classroom)
        .where(Classroom.id == classroom_id, Classroom.teacher_id == teacher_id)
        .options(
            selectinload(Classroom.enrollments).selectinload(ClassroomStudent.student),
            selectinload(Classroom.workspace),
        )
    )
    classroom = result.scalar_one_or_none()
    if classroom is None:
        raise ValueError("Classroom not found or access denied")

    students = [
        {
            "id": e.student_id,
            "display_name": e.student.display_name if e.student else "Unknown",
            "xp": e.student.xp if e.student else 0,
            "level": e.student.level if e.student else 1,
            "joined_at": e.joined_at,
        }
        for e in (classroom.enrollments or [])
    ]

    return {
        "id": classroom.id,
        "teacher_id": classroom.teacher_id,
        "title": classroom.title,
        "join_code": classroom.join_code,
        "created_at": classroom.created_at,
        "student_count": len(students),
        "students": students,
        "shared_workspace_id": classroom.workspace.id if classroom.workspace else None,
    }


async def get_student_progress(
    db: AsyncSession,
    teacher_id: str,
    student_id: str,
    classroom_id: int,
) -> dict:
    """Return a student's activity history and mastery data within a classroom workspace.

    Validates that the requesting teacher owns the classroom.
    """
    # Validate teacher owns classroom
    classroom = (
        await db.execute(
            select(Classroom)
            .where(Classroom.id == classroom_id, Classroom.teacher_id == teacher_id)
            .options(selectinload(Classroom.workspace))
        )
    ).scalar_one_or_none()
    if classroom is None:
        raise ValueError("Classroom not found or access denied")

    # Validate student is enrolled
    enrollment = (
        await db.execute(
            select(ClassroomStudent).where(
                ClassroomStudent.classroom_id == classroom_id,
                ClassroomStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if enrollment is None:
        raise ValueError("Student is not enrolled in this classroom")

    # Get student info
    student = await db.get(User, student_id)

    # Get mastery records for claims in the classroom workspace
    workspace = classroom.workspace
    if workspace is None:
        return {
            "student_id": student_id,
            "display_name": student.display_name if student else None,
            "mastery": [],
            "activity_history": [],
        }

    # Get all claim IDs in the workspace via topics
    from app.models.tables import AtomicClaim, Topic

    claims_result = await db.execute(
        select(AtomicClaim.id).join(Topic).where(Topic.workspace_id == workspace.id)
    )
    claim_ids = [row[0] for row in claims_result.all()]

    # Get mastery for those claims
    mastery_result = await db.execute(
        select(UserMastery).where(
            UserMastery.user_id == student_id,
            UserMastery.claim_id.in_(claim_ids) if claim_ids else False,
        )
    )
    masteries = mastery_result.scalars().all() if claim_ids else []

    # Get activity attempts (both personal and shared) within this workspace
    from app.models.tables import ActivityAttempt

    attempts_result = await db.execute(
        select(ActivityAttempt)
        .join(Activity)
        .where(
            ActivityAttempt.user_id == student_id,
            Activity.workspace_id == workspace.id,
        )
        .order_by(ActivityAttempt.attempted_at.desc())
    )
    attempts = attempts_result.scalars().all()

    return {
        "student_id": student_id,
        "display_name": student.display_name if student else None,
        "xp": student.xp if student else 0,
        "level": student.level if student else 1,
        "streak_days": student.streak_days if student else 0,
        "mastery": [
            {
                "claim_id": m.claim_id,
                "understanding_rating": m.understanding_rating,
                "status": m.status,
            }
            for m in masteries
        ],
        "activity_history": [
            {
                "activity_id": a.activity_id,
                "claim_id": a.claim_id,
                "outcome": a.outcome,
                "student_response": a.student_response,
                "feedback": a.feedback,
                "xp_awarded": a.xp_awarded,
                "attempted_at": a.attempted_at.isoformat() if a.attempted_at else None,
            }
            for a in attempts
        ],
    }


async def get_diagnostic(
    db: AsyncSession,
    teacher_id: str,
    classroom_id: int,
) -> dict:
    """Return mastery_matrix: {student_id: {claim_id: understanding_rating}}.

    Covers all students enrolled in the classroom and all claims in the
    classroom's shared workspace.
    """
    # Validate teacher owns classroom
    classroom = (
        await db.execute(
            select(Classroom)
            .where(Classroom.id == classroom_id, Classroom.teacher_id == teacher_id)
            .options(
                selectinload(Classroom.enrollments),
                selectinload(Classroom.workspace),
            )
        )
    ).scalar_one_or_none()
    if classroom is None:
        raise ValueError("Classroom not found or access denied")

    student_ids = [e.student_id for e in (classroom.enrollments or [])]

    # Get all claim IDs in the workspace
    workspace = classroom.workspace
    if workspace is None or not student_ids:
        return {
            "classroom_id": classroom_id,
            "student_ids": student_ids,
            "claim_ids": [],
            "mastery_matrix": {},
        }

    from app.models.tables import AtomicClaim, Topic

    claims_result = await db.execute(
        select(AtomicClaim.id).join(Topic).where(Topic.workspace_id == workspace.id)
    )
    claim_ids = [row[0] for row in claims_result.all()]

    if not claim_ids:
        return {
            "classroom_id": classroom_id,
            "student_ids": student_ids,
            "claim_ids": [],
            "mastery_matrix": {},
        }

    # Fetch all mastery rows for enrolled students x workspace claims
    mastery_result = await db.execute(
        select(UserMastery).where(
            UserMastery.user_id.in_(student_ids),
            UserMastery.claim_id.in_(claim_ids),
        )
    )
    masteries = mastery_result.scalars().all()

    # Build matrix
    matrix: dict[str, dict[str, int]] = {sid: {} for sid in student_ids}
    for m in masteries:
        matrix[m.user_id][m.claim_id] = m.understanding_rating

    return {
        "classroom_id": classroom_id,
        "student_ids": student_ids,
        "claim_ids": claim_ids,
        "mastery_matrix": matrix,
    }


async def get_classroom_activity_history(
    db: AsyncSession,
    teacher_id: str,
    classroom_id: int,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Return chronological activity attempts for all students in a classroom."""
    logger.info("Get classroom activity history: classroom_id=%s teacher_id=%s", classroom_id, teacher_id)
    from app.models.tables import ActivityAttempt, AtomicClaim

    classroom = (
        await db.execute(
            select(Classroom)
            .where(Classroom.id == classroom_id, Classroom.teacher_id == teacher_id)
            .options(selectinload(Classroom.workspace))
        )
    ).scalar_one_or_none()
    if classroom is None:
        raise ValueError("Classroom not found or access denied")

    workspace = classroom.workspace
    if workspace is None:
        return {"classroom_id": classroom_id, "items": [], "total": 0}

    base_query = (
        select(ActivityAttempt)
        .join(Activity, ActivityAttempt.activity_id == Activity.id)
        .where(Activity.workspace_id == workspace.id)
    )

    from sqlalchemy import func

    count_result = await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )
    total = count_result.scalar() or 0

    attempts_result = await db.execute(
        base_query
        .options(
            selectinload(ActivityAttempt.user),
            selectinload(ActivityAttempt.activity),
            selectinload(ActivityAttempt.claim),
        )
        .order_by(ActivityAttempt.attempted_at.desc())
        .offset(offset)
        .limit(limit)
    )
    attempts = attempts_result.scalars().all()

    items = []
    for a in attempts:
        items.append({
            "id": a.id,
            "student_id": a.user_id,
            "student_name": a.user.display_name if a.user else "Unknown",
            "activity_type": a.activity.type if a.activity else "unknown",
            "activity_title": a.activity.title if a.activity else "Unknown Activity",
            "claim_title": a.claim.title if a.claim else None,
            "outcome": a.outcome,
            "student_response": a.student_response,
            "feedback": a.feedback,
            "xp_awarded": a.xp_awarded,
            "attempted_at": a.attempted_at.isoformat() if a.attempted_at else None,
            "activity_payload": a.activity.payload if a.activity else None,
        })

    return {"classroom_id": classroom_id, "items": items, "total": total}


async def broadcast_activity_to_class(
    db: AsyncSession,
    classroom_id: int,
    activity_id: int,
) -> None:
    """Add activity to all enrolled students' queues (spec 2.4)."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    enrollments_result = await db.execute(
        select(ClassroomStudent.student_id).where(
            ClassroomStudent.classroom_id == classroom_id,
        )
    )
    student_ids = [row[0] for row in enrollments_result.all()]

    logger.info("Broadcasting activity_id=%s to classroom_id=%s (%d students)", activity_id, classroom_id, len(student_ids))

    if not student_ids:
        return

    values = [
        {"user_id": sid, "activity_id": activity_id}
        for sid in student_ids
    ]

    stmt = pg_insert(UserActivityQueue).values(values).on_conflict_do_nothing(
        constraint="uq_user_activity"
    )
    await db.execute(stmt)
    await db.flush()
