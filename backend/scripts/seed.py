"""Seed script — run with: python -m scripts.seed

Populates demo users, a sample topic, and a handful of atomic claims
so the frontend has data to render immediately.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import Base
from app.models.tables import AtomicClaim, Topic, TopicPrerequisite, User, UserMastery, Workspace
from app.api.routes.auth import random_avatar

settings = get_settings()
engine = create_engine(settings.sync_database_url, echo=True)


def seed():
    Base.metadata.create_all(engine)
    Ses = sessionmaker(bind=engine)

    with Ses() as db:
        # ── Demo users ───────────────────────────────────────────────────
        db.merge(User(
            id="usr_student_demo",
            display_name="Demo Student",
            email="student@demo.axiom",
            role="student",
            avatar=random_avatar(),
            xp=0, level=1, streak_days=0,
        ))
        db.merge(User(
            id="usr_teacher_demo",
            display_name="Demo Teacher",
            email="teacher@demo.axiom",
            role="teacher",
            avatar=random_avatar(),
            xp=0, level=1, streak_days=0,
        ))
        db.merge(User(
            id="usr_learner_demo",
            display_name="Demo Learner",
            email="learner@demo.axiom",
            role="individual_learner",
            avatar=random_avatar(),
            xp=0, level=1, streak_days=0,
        ))

        # ── Personal workspace for the learner ───────────────────────────
        db.merge(Workspace(
            id=1,
            user_id="usr_learner_demo",
            title="Linear Algebra",
            description="Demo workspace for linear algebra topics",
            is_classroom_shared=False,
        ))

        # ── Topics ───────────────────────────────────────────────────────
        db.merge(Topic(
            id="top_row_reduction",
            workspace_id=1,
            slug="row-reduction",
            title="Row Reduction & Echelon Forms",
            summary="Systematic methods for solving systems of linear equations using elementary row operations.",
        ))
        db.merge(Topic(
            id="top_gauss_elim",
            workspace_id=1,
            slug="gaussian-elimination",
            title="Gaussian Elimination",
            summary="An algorithm for solving systems of linear equations by reducing to row echelon form.",
        ))
        db.merge(Topic(
            id="top_matrix_inverse",
            workspace_id=1,
            slug="matrix-inverse",
            title="Matrix Inverses",
            summary="Conditions for invertibility and algorithms to compute the inverse of a square matrix.",
        ))

        # ── Prerequisites ────────────────────────────────────────────────
        db.merge(TopicPrerequisite(topic_id="top_gauss_elim", prerequisite_id="top_row_reduction"))
        db.merge(TopicPrerequisite(topic_id="top_matrix_inverse", prerequisite_id="top_gauss_elim"))

        # ── Atomic claims for Row Reduction ──────────────────────────────
        db.merge(AtomicClaim(
            id="claim_rr_01",
            topic_id="top_row_reduction",
            title="Three elementary row operations",
            content="The three elementary row operations are: (1) swap two rows, (2) multiply a row by a nonzero scalar, and (3) add a scalar multiple of one row to another row.",
            diagnostic_prompt="The snippet below claims there are elementary row operations but contains an error. Identify the mistake and explain why it matters.",
            flawed_snippet="The three elementary row operations are:\n1. Swap two rows\n2. Multiply a row by any scalar\n3. Add one row to another",
            rubric="The student must identify TWO errors: (a) the scalar in operation 2 must be nonzero (multiplying by zero destroys information), and (b) operation 3 should say 'a scalar multiple of one row' not just 'one row' (the general form allows scaling before adding).",
        ))
        db.merge(AtomicClaim(
            id="claim_rr_02",
            topic_id="top_row_reduction",
            title="Row echelon form definition",
            content="A matrix is in row echelon form (REF) if: (1) all zero rows are at the bottom, (2) each leading entry (pivot) is in a column to the right of the leading entry of the row above, and (3) all entries below a pivot are zero.",
            diagnostic_prompt="This definition of row echelon form has a subtle gap. What condition is missing or misstated?",
            flawed_snippet="A matrix is in row echelon form if:\n1. Each leading entry is to the right of the one above\n2. All entries below a pivot are zero",
            rubric="The student must note that the definition omits the requirement that all-zero rows must be at the bottom of the matrix. Without this, a matrix like [[0,0],[1,2]] would incorrectly qualify.",
        ))
        db.merge(AtomicClaim(
            id="claim_rr_03",
            topic_id="top_row_reduction",
            title="Uniqueness of RREF",
            content="Every matrix has exactly one reduced row echelon form (RREF). While there are many paths of row operations to reach it, the final RREF is unique.",
            diagnostic_prompt="The claim below about RREF is wrong. Explain the error.",
            flawed_snippet="A matrix can have multiple valid reduced row echelon forms depending on the order of row operations you choose.",
            rubric="Student must state that RREF is unique for any given matrix — the theorem guarantees the result is the same regardless of the sequence of elementary row operations used.",
        ))

        # ── Atomic claims for Gaussian Elimination ───────────────────────
        db.merge(AtomicClaim(
            id="claim_ge_01",
            topic_id="top_gauss_elim",
            title="Forward elimination phase",
            content="The forward elimination phase of Gaussian elimination uses row operations to produce an upper triangular (row echelon) form, processing columns left to right and eliminating entries below each pivot.",
            diagnostic_prompt="This description of forward elimination contains an error in the process. What is wrong?",
            flawed_snippet="Forward elimination processes columns right to left, eliminating entries below each pivot to reach row echelon form.",
            rubric="Student must identify that forward elimination processes columns LEFT to RIGHT, not right to left. The pivot column advances from the leftmost to the rightmost.",
        ))
        db.merge(AtomicClaim(
            id="claim_ge_02",
            topic_id="top_gauss_elim",
            title="Partial pivoting for numerical stability",
            content="Partial pivoting selects the entry with the largest absolute value in the current column (at or below the pivot row) as the pivot, swapping rows if necessary. This reduces numerical error caused by dividing by small numbers.",
            diagnostic_prompt="The pivoting strategy described below has a flaw. Identify it.",
            flawed_snippet="In partial pivoting, we select the smallest nonzero entry in the pivot column as our pivot to minimize the multiplier values.",
            rubric="Student must explain that partial pivoting selects the LARGEST absolute value (not smallest) to serve as pivot. Using the smallest value leads to large multipliers that amplify floating-point errors.",
        ))

        db.commit()
        print("Seed data inserted successfully.")


if __name__ == "__main__":
    if not settings.run_seed_on_startup:
        print("Seed skipped: RUN_SEED_ON_STARTUP is false.")
    else:
        seed()
