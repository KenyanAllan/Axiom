"""SQLAlchemy ORM models — matches the APKGS DDL spec exactly."""

from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


# ── Users ───────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)                   # e.g. 'usr_student_demo'
    display_name = Column(String, nullable=False)
    role = Column(String, nullable=False)                   # 'student' | 'teacher'
    xp = Column(Integer, nullable=False, default=0)
    level = Column(Integer, nullable=False, default=1)

    masteries = relationship("UserMastery", back_populates="user", lazy="selectin")


# ── Topics ──────────────────────────────────────────────────────────────────────

class Topic(Base):
    __tablename__ = "topics"

    id = Column(String, primary_key=True)                   # e.g. 'top_gauss_elim'
    slug = Column(String, unique=True, nullable=False)
    title = Column(String, nullable=False)
    summary = Column(Text)
    embedding = Column(Vector(1024))

    claims = relationship("AtomicClaim", back_populates="topic", lazy="selectin")

    # Many-to-many self-referential for prerequisites
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

    id = Column(String, primary_key=True)                   # e.g. 'claim_ge_01'
    topic_id = Column(
        String, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False
    )
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    diagnostic_prompt = Column(Text)                        # "Wrong on Purpose" prompt
    flawed_snippet = Column(Text)
    rubric = Column(Text)
    embedding = Column(Vector(1024))

    topic = relationship("Topic", back_populates="claims")
    masteries = relationship("UserMastery", back_populates="claim", lazy="selectin")


# ── User Mastery ────────────────────────────────────────────────────────────────

class UserMastery(Base):
    __tablename__ = "user_mastery"

    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    claim_id = Column(
        String, ForeignKey("atomic_claims.id", ondelete="CASCADE"), primary_key=True
    )
    status = Column(String, nullable=False, default="unseen")  # unseen | active | mastered
    history = Column(JSONB, nullable=False, default=list)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="masteries")
    claim = relationship("AtomicClaim", back_populates="masteries")
