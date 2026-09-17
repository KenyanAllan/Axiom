"""SQLAlchemy ORM models — matches the Axiom domain rules spec."""

from datetime import date, datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


# ── Users ───────────────────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    display_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=True)
    avatar = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)
    role = Column(String, nullable=False)  # student | teacher | individual_learner
    xp = Column(Integer, nullable=False, default=0)
    level = Column(Integer, nullable=False, default=1)
    streak_days = Column(Integer, nullable=False, default=0)
    last_active_date = Column(Date, nullable=True)
    preferred_language = Column(String, nullable=True, default="en")

    masteries = relationship("UserMastery", back_populates="user", lazy="selectin")
    workspaces = relationship("Workspace", back_populates="owner", lazy="selectin")
    queue_entries = relationship("UserActivityQueue", back_populates="user", lazy="selectin")


# ── Classrooms ──────────────────────────────────────────────────────────────────


class Classroom(Base):
    __tablename__ = "classrooms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    teacher_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title = Column(String, nullable=False)
    join_code = Column(String(6), unique=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    teacher = relationship("User", foreign_keys=[teacher_id])
    workspace = relationship("Workspace", back_populates="classroom", uselist=False)
    enrollments = relationship(
        "ClassroomStudent", back_populates="classroom", lazy="selectin"
    )


class ClassroomStudent(Base):
    __tablename__ = "classroom_students"

    classroom_id = Column(
        Integer, ForeignKey("classrooms.id", ondelete="CASCADE"), primary_key=True
    )
    student_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    joined_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    classroom = relationship("Classroom", back_populates="enrollments")
    student = relationship("User")


# ── Workspaces ──────────────────────────────────────────────────────────────────


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    classroom_id = Column(
        Integer, ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True
    )
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    is_classroom_shared = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    owner = relationship("User", back_populates="workspaces")
    classroom = relationship("Classroom", back_populates="workspace")
    topics = relationship("Topic", back_populates="workspace", lazy="selectin")
    activities = relationship("Activity", back_populates="workspace", lazy="selectin")
    source_documents = relationship("SourceDocument", back_populates="workspace", lazy="selectin")
    glossary_terms = relationship("GlossaryTerm", back_populates="workspace", lazy="selectin")
    figures = relationship("Figure", back_populates="workspace")


# ── Source Documents (Layer 1 Ground-Truth) ──────────────────────────────────


class SourceDocument(Base):
    __tablename__ = "source_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    uploader_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    filename = Column(String, nullable=False)
    s3_key = Column(String, nullable=False)
    content_type = Column(String, nullable=False, default="application/pdf")
    size_bytes = Column(Integer, nullable=True)
    status = Column(String, nullable=False, default="uploaded")  # uploaded | processing | ready | error
    transcript_s3_key = Column(String, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    workspace = relationship("Workspace", back_populates="source_documents")
    uploader = relationship("User")
    figures = relationship("Figure", back_populates="source_document")


# ── Topics (WikiPages) ─────────────────────────────────────────────────────────


class Topic(Base):
    __tablename__ = "topics"

    id = Column(String, primary_key=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    slug = Column(String, unique=True, nullable=False)
    title = Column(String, nullable=False)
    summary = Column(Text)
    embedding = Column(Vector(1024))
    complexity_score = Column(Float, nullable=True)

    workspace = relationship("Workspace", back_populates="topics")
    claims = relationship("AtomicClaim", back_populates="topic", lazy="selectin")

    prerequisites = relationship(
        "Topic",
        secondary="topic_prerequisites",
        primaryjoin="Topic.id == TopicPrerequisite.topic_id",
        secondaryjoin="Topic.id == TopicPrerequisite.prerequisite_id",
        lazy="selectin",
    )


class TopicPrerequisite(Base):
    __tablename__ = "topic_prerequisites"

    topic_id = Column(
        String, ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )
    prerequisite_id = Column(
        String, ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True
    )


# ── Atomic Claims ──────────────────────────────────────────────────────────────


class AtomicClaim(Base):
    __tablename__ = "atomic_claims"

    id = Column(String, primary_key=True)
    topic_id = Column(
        String, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False
    )
    source_document_id = Column(
        Integer, ForeignKey("source_documents.id", ondelete="SET NULL"), nullable=True
    )
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    diagnostic_prompt = Column(Text)
    flawed_snippet = Column(Text)
    rubric = Column(Text)
    embedding = Column(Vector(1024))
    original_language = Column(String, nullable=True)
    original_content = Column(Text, nullable=True)
    complexity_score = Column(Float, nullable=True)

    topic = relationship("Topic", back_populates="claims")
    source_document = relationship("SourceDocument")
    masteries = relationship("UserMastery", back_populates="claim", lazy="selectin")


# ── Glossary Terms ─────────────────────────────────────────────────────────────


class GlossaryTerm(Base):
    __tablename__ = "glossary_terms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    source_document_id = Column(
        Integer, ForeignKey("source_documents.id", ondelete="SET NULL"), nullable=True
    )
    term = Column(String, nullable=False)
    definition = Column(Text, nullable=False)
    source_ref = Column(JSONB, nullable=True)
    is_auto_extracted = Column(Boolean, nullable=False, default=True)
    embedding = Column(Vector(1024))
    original_language = Column(String, nullable=True)
    original_definition = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    workspace = relationship("Workspace", back_populates="glossary_terms")
    source_document = relationship("SourceDocument")

    __table_args__ = (
        UniqueConstraint("workspace_id", "term", name="uq_workspace_term"),
    )


# ── Figures ────────────────────────────────────────────────────────────────────


class Figure(Base):
    __tablename__ = "figures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    source_document_id = Column(
        Integer, ForeignKey("source_documents.id", ondelete="SET NULL"), nullable=True
    )
    s3_key = Column(String, nullable=False)
    content_type = Column(String, nullable=False)
    page_number = Column(Integer, nullable=True)
    caption = Column(Text, nullable=False)
    figure_type = Column(String, nullable=False, default="unknown")
    labels = Column(JSONB, nullable=True)
    ocr_text = Column(Text, nullable=True)
    embedding = Column(Vector(1024))
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    is_decorative = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    workspace = relationship("Workspace", back_populates="figures")
    source_document = relationship("SourceDocument", back_populates="figures")


class FigureClaim(Base):
    __tablename__ = "figure_claims"

    figure_id = Column(
        Integer, ForeignKey("figures.id", ondelete="CASCADE"), primary_key=True
    )
    claim_id = Column(
        String, ForeignKey("atomic_claims.id", ondelete="CASCADE"), primary_key=True
    )
    similarity_score = Column(Float, nullable=True)


# ── User Mastery ────────────────────────────────────────────────────────────────


class UserMastery(Base):
    __tablename__ = "user_mastery"

    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    claim_id = Column(
        String, ForeignKey("atomic_claims.id", ondelete="CASCADE"), primary_key=True
    )
    understanding_rating = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="unseen")
    history = Column(JSONB, nullable=False, default=list)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="masteries")
    claim = relationship("AtomicClaim", back_populates="masteries")


# ── Activities ──────────────────────────────────────────────────────────────────


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    creator_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    classroom_id = Column(
        Integer, ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True
    )
    scope = Column(String, nullable=False, default="STUDENT_PERSONAL")
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    difficulty = Column(Integer, nullable=False, default=1)
    target_claim_ids = Column(JSONB, nullable=False, default=list)
    friction_levers = Column(JSONB, nullable=True)
    payload = Column(JSONB, nullable=False, default=dict)
    audit_passed = Column(Boolean, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    workspace = relationship("Workspace", back_populates="activities")
    creator = relationship("User", foreign_keys=[creator_id])
    classroom = relationship("Classroom")
    queue_entries = relationship(
        "UserActivityQueue", back_populates="activity", lazy="selectin"
    )
    attempts = relationship(
        "ActivityAttempt", back_populates="activity", lazy="selectin"
    )


class UserActivityQueue(Base):
    __tablename__ = "user_activity_queue"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    activity_id = Column(
        Integer, ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    is_completed = Column(Boolean, nullable=False, default=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    added_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="queue_entries")
    activity = relationship("Activity", back_populates="queue_entries")

    __table_args__ = (
        UniqueConstraint("user_id", "activity_id", name="uq_user_activity"),
    )


class ActivityAttempt(Base):
    __tablename__ = "activity_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    activity_id = Column(
        Integer, ForeignKey("activities.id", ondelete="CASCADE"), nullable=True
    )
    claim_id = Column(
        String, ForeignKey("atomic_claims.id", ondelete="CASCADE"), nullable=True
    )
    outcome = Column(String, nullable=False)  # understood | did_not_understand | neutral
    student_response = Column(Text, nullable=True)
    response_image_s3_key = Column(String, nullable=True)
    feedback = Column(Text, nullable=True)
    hints_used = Column(Boolean, nullable=False, default=False)
    difficulty = Column(Integer, nullable=False, default=1)
    xp_awarded = Column(Integer, nullable=False, default=0)
    rating_change = Column(Integer, nullable=False, default=0)
    attempted_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User")
    activity = relationship("Activity", back_populates="attempts")
    claim = relationship("AtomicClaim")


# ── Chat Sessions ──────────────────────────────────────────────────────────────


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User")
    workspace = relationship("Workspace")
    messages = relationship("ChatMessage", back_populates="session", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(
        Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    role = Column(String, nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    sources = Column(JSONB, nullable=True)
    image_s3_keys = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    session = relationship("ChatSession", back_populates="messages")
