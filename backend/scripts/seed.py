"""Seed script — run with: python -m scripts.seed

Populates demo users, topics, atomic claims, a classroom, mastery records,
pre-generated activities, a chat session, glossary terms, and a source
document reference so the frontend has rich data to render immediately.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import Base
from app.models.tables import (
    Activity,
    ActivityAttempt,
    AtomicClaim,
    ChatMessage,
    ChatSession,
    Classroom,
    ClassroomStudent,
    GlossaryTerm,
    SourceDocument,
    Topic,
    TopicPrerequisite,
    User,
    UserActivityQueue,
    UserMastery,
    Workspace,
)
from app.api.routes.auth import random_avatar

settings = get_settings()
engine = create_engine(settings.sync_database_url, echo=True)

NOW = datetime.now(timezone.utc)


def seed():
    Base.metadata.create_all(engine)
    Ses = sessionmaker(bind=engine)

    with Ses() as db:
        # ── 1a. Demo users (aligned with frontend use-demo-user.ts) ──────
        db.merge(User(
            id="usr_student_demo",
            display_name="Sam Richards",
            email="student@demo.axiom",
            role="student",
            avatar="🧠|#3b82f6",
            xp=3450, level=11, streak_days=6,
            last_active_date=(NOW - timedelta(hours=4)).date(),
        ))
        db.merge(User(
            id="usr_teacher_demo",
            display_name="Prof. Torres",
            email="teacher@demo.axiom",
            role="teacher",
            avatar="🎓|#8b5cf6",
            xp=0, level=1, streak_days=0,
        ))
        db.merge(User(
            id="usr_learner_demo",
            display_name="Alex Chen",
            email="learner@demo.axiom",
            role="individual_learner",
            avatar="🚀|#10b981",
            xp=1200, level=5, streak_days=3,
            last_active_date=(NOW - timedelta(days=1)).date(),
        ))

        # ── 1c. Classroom ────────────────────────────────────────────────
        db.merge(Classroom(
            id=1,
            teacher_id="usr_teacher_demo",
            title="MATH 221 — Linear Algebra",
            join_code="AX2024",
            created_at=NOW - timedelta(days=30),
        ))
        db.merge(ClassroomStudent(
            classroom_id=1,
            student_id="usr_student_demo",
            joined_at=NOW - timedelta(days=28),
        ))

        # ── Workspaces ───────────────────────────────────────────────────
        db.merge(Workspace(
            id=1,
            user_id="usr_learner_demo",
            title="Linear Algebra",
            description="Core linear algebra topics from Lay's textbook.",
            is_classroom_shared=False,
        ))
        db.merge(Workspace(
            id=2,
            user_id="usr_teacher_demo",
            classroom_id=1,
            title="MATH 221 — Linear Algebra",
            description="Shared workspace for MATH 221 class.",
            is_classroom_shared=True,
        ))

        # ── 1h. Source document reference ────────────────────────────────
        db.merge(SourceDocument(
            id=1,
            workspace_id=1,
            uploader_id="usr_learner_demo",
            filename="Lay_Linear_Algebra_5th_Ed.pdf",
            s3_key="uploads/workspace_1/Lay_Linear_Algebra_5th_Ed.pdf",
            content_type="application/pdf",
            size_bytes=14_500_000,
            status="ready",
            metadata_={"pages": 576, "author": "David C. Lay", "edition": "5th"},
            created_at=NOW - timedelta(days=25),
        ))

        # ── 1b. Topics (all 8 matching frontend CenterStage.tsx) ────────
        db.merge(Topic(
            id="top_row_reduction",
            workspace_id=1,
            slug="row-reduction",
            title="Row Reduction & Echelon Forms",
            summary="Systematic methods for solving systems of linear equations using elementary row operations.",
            complexity_score=1.5,
        ))
        db.merge(Topic(
            id="top_gauss_elim",
            workspace_id=1,
            slug="gaussian-elimination",
            title="Gaussian Elimination",
            summary="An algorithm for solving systems of linear equations by reducing to row echelon form.",
            complexity_score=2.0,
        ))
        db.merge(Topic(
            id="top_matrix_inverse",
            workspace_id=1,
            slug="matrix-inverse",
            title="Matrix Inverses",
            summary="Conditions for invertibility and algorithms to compute the inverse of a square matrix.",
            complexity_score=2.5,
        ))
        db.merge(Topic(
            id="top_determinants",
            workspace_id=1,
            slug="determinants",
            title="Determinants",
            summary="The determinant is a scalar value that encodes properties of a square matrix. A matrix is invertible if and only if its determinant is nonzero.",
            complexity_score=2.5,
        ))
        db.merge(Topic(
            id="top_vector_spaces",
            workspace_id=1,
            slug="vector-spaces",
            title="Vector Spaces",
            summary="A vector space is a set equipped with vector addition and scalar multiplication satisfying eight axioms. Subspaces are subsets that are themselves vector spaces.",
            complexity_score=3.0,
        ))
        db.merge(Topic(
            id="top_eigenvalues",
            workspace_id=1,
            slug="eigenvalues",
            title="Eigenvalues",
            summary="An eigenvalue λ of matrix A satisfies Ax = λx for some nonzero eigenvector x. Eigenvalues reveal fundamental properties of linear transformations.",
            complexity_score=3.5,
        ))
        db.merge(Topic(
            id="top_svd",
            workspace_id=1,
            slug="svd",
            title="SVD",
            summary="The SVD factors any m×n matrix A into UΣVᵀ where U and V are orthogonal and Σ is diagonal with nonnegative singular values.",
            complexity_score=4.0,
        ))
        db.merge(Topic(
            id="top_orthogonality",
            workspace_id=1,
            slug="orthogonality",
            title="Orthogonality",
            summary="Two vectors are orthogonal if their dot product is zero. Orthogonal bases simplify projections, decompositions, and least-squares problems.",
            complexity_score=3.0,
        ))

        # ── Prerequisites (DAG) ──────────────────────────────────────────
        prereqs = [
            ("top_gauss_elim", "top_row_reduction"),
            ("top_matrix_inverse", "top_gauss_elim"),
            ("top_determinants", "top_matrix_inverse"),
            ("top_vector_spaces", "top_determinants"),
            ("top_eigenvalues", "top_vector_spaces"),
            ("top_svd", "top_eigenvalues"),
            ("top_orthogonality", "top_vector_spaces"),
        ]
        for topic_id, prereq_id in prereqs:
            db.merge(TopicPrerequisite(topic_id=topic_id, prerequisite_id=prereq_id))

        # ── 1b. Atomic claims ────────────────────────────────────────────
        # --- Row Reduction (existing 3, kept) ---
        db.merge(AtomicClaim(
            id="claim_rr_01",
            topic_id="top_row_reduction",
            source_document_id=1,
            title="Three elementary row operations",
            content="The three elementary row operations are: (1) swap two rows, (2) multiply a row by a nonzero scalar, and (3) add a scalar multiple of one row to another row.",
            diagnostic_prompt="The snippet below claims there are elementary row operations but contains an error. Identify the mistake and explain why it matters.",
            flawed_snippet="The three elementary row operations are:\n1. Swap two rows\n2. Multiply a row by any scalar\n3. Add one row to another",
            rubric="The student must identify TWO errors: (a) the scalar in operation 2 must be nonzero (multiplying by zero destroys information), and (b) operation 3 should say 'a scalar multiple of one row' not just 'one row' (the general form allows scaling before adding).",
            complexity_score=1.0,
        ))
        db.merge(AtomicClaim(
            id="claim_rr_02",
            topic_id="top_row_reduction",
            source_document_id=1,
            title="Row echelon form definition",
            content="A matrix is in row echelon form (REF) if: (1) all zero rows are at the bottom, (2) each leading entry (pivot) is in a column to the right of the leading entry of the row above, and (3) all entries below a pivot are zero.",
            diagnostic_prompt="This definition of row echelon form has a subtle gap. What condition is missing or misstated?",
            flawed_snippet="A matrix is in row echelon form if:\n1. Each leading entry is to the right of the one above\n2. All entries below a pivot are zero",
            rubric="The student must note that the definition omits the requirement that all-zero rows must be at the bottom of the matrix. Without this, a matrix like [[0,0],[1,2]] would incorrectly qualify.",
            complexity_score=1.5,
        ))
        db.merge(AtomicClaim(
            id="claim_rr_03",
            topic_id="top_row_reduction",
            source_document_id=1,
            title="Uniqueness of RREF",
            content="Every matrix has exactly one reduced row echelon form (RREF). While there are many paths of row operations to reach it, the final RREF is unique.",
            diagnostic_prompt="The claim below about RREF is wrong. Explain the error.",
            flawed_snippet="A matrix can have multiple valid reduced row echelon forms depending on the order of row operations you choose.",
            rubric="Student must state that RREF is unique for any given matrix — the theorem guarantees the result is the same regardless of the sequence of elementary row operations used.",
            complexity_score=1.5,
        ))

        # --- Gaussian Elimination (existing 2, kept) ---
        db.merge(AtomicClaim(
            id="claim_ge_01",
            topic_id="top_gauss_elim",
            source_document_id=1,
            title="Forward elimination phase",
            content="The forward elimination phase of Gaussian elimination uses row operations to produce an upper triangular (row echelon) form, processing columns left to right and eliminating entries below each pivot.",
            diagnostic_prompt="This description of forward elimination contains an error in the process. What is wrong?",
            flawed_snippet="Forward elimination processes columns right to left, eliminating entries below each pivot to reach row echelon form.",
            rubric="Student must identify that forward elimination processes columns LEFT to RIGHT, not right to left. The pivot column advances from the leftmost to the rightmost.",
            complexity_score=2.0,
        ))
        db.merge(AtomicClaim(
            id="claim_ge_02",
            topic_id="top_gauss_elim",
            source_document_id=1,
            title="Partial pivoting for numerical stability",
            content="Partial pivoting selects the entry with the largest absolute value in the current column (at or below the pivot row) as the pivot, swapping rows if necessary. This reduces numerical error caused by dividing by small numbers.",
            diagnostic_prompt="The pivoting strategy described below has a flaw. Identify it.",
            flawed_snippet="In partial pivoting, we select the smallest nonzero entry in the pivot column as our pivot to minimize the multiplier values.",
            rubric="Student must explain that partial pivoting selects the LARGEST absolute value (not smallest) to serve as pivot. Using the smallest value leads to large multipliers that amplify floating-point errors.",
            complexity_score=2.5,
        ))

        # --- Matrix Inverses (new) ---
        db.merge(AtomicClaim(
            id="claim_mi_01",
            topic_id="top_matrix_inverse",
            source_document_id=1,
            title="Invertibility requires square and full rank",
            content="Only square matrices can be invertible, and they must have full rank — every row and column contains a pivot in RREF.",
            diagnostic_prompt="The claim below about matrix invertibility is incorrect. What is wrong?",
            flawed_snippet="Any matrix with full rank is invertible, regardless of whether it is square or rectangular.",
            rubric="Student must explain that invertibility requires the matrix to be SQUARE. A 3×5 matrix can have full row rank but is not invertible because it is not square — there is no matrix B such that AB = BA = I.",
            complexity_score=2.0,
        ))
        db.merge(AtomicClaim(
            id="claim_mi_02",
            topic_id="top_matrix_inverse",
            source_document_id=1,
            title="Augmented row reduction computes A⁻¹",
            content="To find A⁻¹, augment A with I and row-reduce: [A|I] → [I|A⁻¹]. If A is singular, the left side won't reduce to I.",
            diagnostic_prompt="The procedure described below for finding the inverse has an error. What is it?",
            flawed_snippet="To find A⁻¹, row-reduce [I|A]. When the right side becomes the identity, the left side is A⁻¹.",
            rubric="Student must note that the augmented matrix should be [A|I], not [I|A]. You start with A on the left and the identity on the right, then row-reduce until the left becomes I.",
            complexity_score=2.5,
        ))

        # --- Determinants (new) ---
        db.merge(AtomicClaim(
            id="claim_det_01",
            topic_id="top_determinants",
            source_document_id=1,
            title="Cofactor expansion",
            content="The determinant can be computed by expanding along any row or column, summing the products of entries and their cofactors with alternating signs.",
            diagnostic_prompt="The statement below about cofactor expansion contains an error. What is it?",
            flawed_snippet="The determinant must always be computed by expanding along the first row. Expanding along other rows or columns gives different results.",
            rubric="Student must explain that cofactor expansion can be performed along ANY row or column and always gives the same result. The choice of row/column is a matter of convenience (e.g., choosing one with many zeros).",
            complexity_score=2.5,
        ))
        db.merge(AtomicClaim(
            id="claim_det_02",
            topic_id="top_determinants",
            source_document_id=1,
            title="det(A) = 0 iff A is singular",
            content="A square matrix is invertible if and only if its determinant is nonzero. Zero determinant means the column vectors are linearly dependent.",
            diagnostic_prompt="The claim below about determinants and invertibility is wrong. Explain why.",
            flawed_snippet="If det(A) = 0, the matrix A is invertible because the determinant measures how much A stretches space.",
            rubric="Student must state that det(A) = 0 means A is NOT invertible (singular). A zero determinant means the transformation collapses at least one dimension, making the column vectors linearly dependent.",
            complexity_score=2.5,
        ))

        # --- Vector Spaces (new) ---
        db.merge(AtomicClaim(
            id="claim_vs_01",
            topic_id="top_vector_spaces",
            source_document_id=1,
            title="Eight vector space axioms",
            content="A vector space must satisfy eight axioms: closure under addition and scalar multiplication, associativity and commutativity of addition, existence of zero vector and additive inverses, plus distributive and scalar identity laws.",
            diagnostic_prompt="The definition below is missing key axioms. What is incomplete?",
            flawed_snippet="A vector space only needs closure under addition and scalar multiplication. If those hold, all other properties follow automatically.",
            rubric="Student must explain that closure alone is not sufficient. The eight axioms also require associativity, commutativity, zero vector, additive inverses, distributive laws, and scalar identity. Counter-example: a set can be closed under operations but lack a zero vector.",
            complexity_score=3.0,
        ))
        db.merge(AtomicClaim(
            id="claim_vs_02",
            topic_id="top_vector_spaces",
            source_document_id=1,
            title="Subspace test",
            content="A subset H of V is a subspace if it contains the zero vector and is closed under addition and scalar multiplication.",
            diagnostic_prompt="The subspace test below is missing a critical check. What is it?",
            flawed_snippet="To verify H is a subspace of V, you only need to check that H is closed under addition and scalar multiplication.",
            rubric="Student must note that the test also requires H to contain the zero vector. A set can be closed under addition and scaling but not contain the zero vector (though technically scalar multiplication by 0 would give the zero vector if closure holds — the explicit check prevents testing the empty set).",
            complexity_score=3.0,
        ))

        # --- Eigenvalues (new) ---
        db.merge(AtomicClaim(
            id="claim_eig_01",
            topic_id="top_eigenvalues",
            source_document_id=1,
            title="Characteristic equation",
            content="Eigenvalues are the roots of det(A − λI) = 0. This polynomial of degree n has at most n roots counting multiplicity.",
            diagnostic_prompt="The statement below about eigenvalues has an error. Identify it.",
            flawed_snippet="Eigenvalues are found by solving det(A + λI) = 0. This always gives exactly n distinct eigenvalues for an n×n matrix.",
            rubric="Student must identify TWO errors: (a) the characteristic equation is det(A − λI) = 0, not det(A + λI) = 0, and (b) an n×n matrix has at most n eigenvalues counting multiplicity — they need not be distinct (repeated eigenvalues) or even real.",
            complexity_score=3.5,
        ))
        db.merge(AtomicClaim(
            id="claim_eig_02",
            topic_id="top_eigenvalues",
            source_document_id=1,
            title="Eigenspace is a subspace",
            content="For each eigenvalue λ, the set of all eigenvectors plus the zero vector forms a subspace called the eigenspace.",
            diagnostic_prompt="The claim below about eigenspaces is wrong. Find the error.",
            flawed_snippet="The eigenspace for λ is exactly the set of eigenvectors for that eigenvalue. The zero vector is an eigenvector too.",
            rubric="Student must explain that the zero vector is NOT an eigenvector (by definition, eigenvectors must be nonzero). However, the eigenspace includes the zero vector to form a proper subspace (null space of A − λI).",
            complexity_score=3.0,
        ))

        # --- SVD (new) ---
        db.merge(AtomicClaim(
            id="claim_svd_01",
            topic_id="top_svd",
            source_document_id=1,
            title="Every matrix has an SVD",
            content="Unlike eigendecomposition, the SVD exists for any m×n matrix, not just square or diagonalizable ones.",
            diagnostic_prompt="The statement below about SVD is incorrect. Explain why.",
            flawed_snippet="The SVD can only be computed for square matrices, just like eigendecomposition.",
            rubric="Student must explain that the SVD exists for ANY m×n matrix — it does not require the matrix to be square. This universality is one of SVD's key advantages over eigendecomposition.",
            complexity_score=3.5,
        ))
        db.merge(AtomicClaim(
            id="claim_svd_02",
            topic_id="top_svd",
            source_document_id=1,
            title="Low-rank approximation via truncated SVD",
            content="The best rank-k approximation of A in Frobenius norm is obtained by keeping only the k largest singular values.",
            diagnostic_prompt="The truncation strategy described below has an error. What is it?",
            flawed_snippet="To get the best rank-k approximation, keep the k smallest singular values and set the rest to zero.",
            rubric="Student must explain that you keep the k LARGEST singular values (not smallest). The largest singular values capture the most variance/energy in the data. Keeping the smallest would give the worst approximation.",
            complexity_score=4.0,
        ))

        # --- Orthogonality (new) ---
        db.merge(AtomicClaim(
            id="claim_orth_01",
            topic_id="top_orthogonality",
            source_document_id=1,
            title="Orthogonal projection formula",
            content="The projection of y onto subspace W with orthonormal basis {u₁,…,uₖ} is proj_W(y) = Σ(y·uᵢ)uᵢ.",
            diagnostic_prompt="The projection formula below has a subtle error. What is it?",
            flawed_snippet="The projection of y onto W is proj_W(y) = Σ(uᵢ·uᵢ)y, where {u₁,...,uₖ} is any basis for W.",
            rubric="Student must identify that (a) the formula should be Σ(y·uᵢ)uᵢ, not Σ(uᵢ·uᵢ)y, and (b) the basis must be orthonormal for this simple formula to work. For a non-orthonormal basis, you need the full projection matrix formula.",
            complexity_score=3.0,
        ))
        db.merge(AtomicClaim(
            id="claim_orth_02",
            topic_id="top_orthogonality",
            source_document_id=1,
            title="Gram-Schmidt produces orthonormal basis",
            content="The Gram-Schmidt process takes any linearly independent set and produces an orthonormal set spanning the same subspace.",
            diagnostic_prompt="The description of Gram-Schmidt below is wrong. Find the error.",
            flawed_snippet="Gram-Schmidt takes any set of vectors (even linearly dependent ones) and produces an orthonormal basis for Rⁿ.",
            rubric="Student must explain that Gram-Schmidt requires the input vectors to be linearly independent. If they are dependent, the process will produce a zero vector at some step. Also, the output spans the same subspace as the input — not necessarily all of Rⁿ.",
            complexity_score=3.0,
        ))

        db.flush()

        # ── 1d. Mastery records for the student ──────────────────────────
        mastery_data = [
            ("claim_rr_01", 5, "mastered"),
            ("claim_rr_02", 4, "mastered"),
            ("claim_rr_03", 5, "mastered"),
            ("claim_ge_01", 4, "mastered"),
            ("claim_ge_02", 3, "active"),
            ("claim_mi_01", 3, "active"),
            ("claim_mi_02", 2, "active"),
            ("claim_det_01", 2, "active"),
            ("claim_det_02", 2, "active"),
            ("claim_vs_01", 1, "unseen"),
            ("claim_vs_02", 1, "unseen"),
            ("claim_eig_01", 1, "unseen"),
            ("claim_eig_02", 1, "unseen"),
            ("claim_svd_01", 1, "unseen"),
            ("claim_svd_02", 1, "unseen"),
            ("claim_orth_01", 1, "unseen"),
            ("claim_orth_02", 1, "unseen"),
        ]
        for claim_id, rating, status in mastery_data:
            db.merge(UserMastery(
                user_id="usr_student_demo",
                claim_id=claim_id,
                understanding_rating=rating,
                status=status,
                history=[{"rating": rating, "ts": NOW.isoformat()}] if status != "unseen" else [],
                updated_at=NOW - timedelta(days=1),
            ))

        # ── 1e. Pre-generated activities ─────────────────────────────────
        activities = [
            Activity(
                id=1,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="flashcard_deck",
                title="Row Reduction Essentials",
                difficulty=1,
                target_claim_ids=["claim_rr_01", "claim_rr_02", "claim_rr_03", "claim_ge_01", "claim_ge_02"],
                payload={
                    "deck_size": 5,
                    "cards": [
                        {"index": 0, "claim_id": "claim_rr_01", "front": "What are the three elementary row operations?", "back": "The three elementary row operations are: (1) swap two rows, (2) multiply a row by a nonzero scalar, and (3) add a scalar multiple of one row to another row."},
                        {"index": 1, "claim_id": "claim_rr_02", "front": "What is row echelon form?", "back": "A matrix is in row echelon form (REF) if: (1) all zero rows are at the bottom, (2) each leading entry (pivot) is in a column to the right of the leading entry of the row above, and (3) all entries below a pivot are zero."},
                        {"index": 2, "claim_id": "claim_rr_03", "front": "Is RREF unique?", "back": "Every matrix has exactly one reduced row echelon form (RREF). While there are many paths of row operations to reach it, the final RREF is unique."},
                        {"index": 3, "claim_id": "claim_ge_01", "front": "What is forward elimination?", "back": "The forward elimination phase of Gaussian elimination uses row operations to produce an upper triangular (row echelon) form, processing columns left to right and eliminating entries below each pivot."},
                        {"index": 4, "claim_id": "claim_ge_02", "front": "What is partial pivoting?", "back": "Partial pivoting selects the entry with the largest absolute value in the current column (at or below the pivot row) as the pivot, swapping rows if necessary."},
                    ],
                },
                created_at=NOW - timedelta(days=10),
            ),
            Activity(
                id=2,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="quiz",
                title="Row Reduction & Echelon Forms Quiz",
                difficulty=1,
                target_claim_ids=["claim_rr_01", "claim_rr_02", "claim_rr_03"],
                payload={
                    "question_count": 5,
                    "questions": [
                        {"index": 0, "type": "multi_choice", "claim_id": "claim_rr_01", "prompt": "Which of the following is NOT an elementary row operation?", "options": ["Swap two rows", "Multiply a row by a nonzero scalar", "Multiply two rows together", "Add a scalar multiple of one row to another"], "correct_index": 2},
                        {"index": 1, "type": "true_false", "claim_id": "claim_rr_02", "prompt": "Every matrix has a unique row echelon form.", "correct_answer": False},
                        {"index": 2, "type": "fill_blank", "claim_id": "claim_rr_03", "prompt": "Every matrix has exactly one reduced ____ form (RREF).", "correct_answer": "row echelon"},
                        {"index": 3, "type": "short_answer", "claim_id": "claim_rr_01", "prompt": "Describe in 2–3 sentences how back substitution works once a system is in row echelon form."},
                        {"index": 4, "type": "multi_choice", "claim_id": "claim_rr_02", "prompt": "If a 3×4 augmented matrix has pivots in columns 1, 2, and 3, the system has:", "options": ["No solution", "Exactly one solution", "Infinitely many solutions", "Cannot be determined"], "correct_index": 1},
                    ],
                },
                created_at=NOW - timedelta(days=9),
            ),
            Activity(
                id=3,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="wrong_on_purpose",
                title="Spot the Flaw: Symmetric Matrix Claim",
                difficulty=2,
                target_claim_ids=["claim_mi_01"],
                payload={
                    "claim": "I hypothesize that multiplying matrix A by its transpose Aᵀ will always produce an identity matrix if A is symmetric.",
                    "flawed_snippet": "# Validate hypothesis\nassert (A @ A.T == np.eye(n)).all(), \"Counterexample:\\nA = [[2, 1], [1, 2]]\"",
                    "prompt": "Identify the false premise in this reasoning.",
                },
                created_at=NOW - timedelta(days=8),
            ),
            Activity(
                id=4,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="scenario",
                title="Network Flow Optimization",
                difficulty=2,
                target_claim_ids=["claim_ge_01", "claim_ge_02"],
                payload={
                    "scenario": "A water utility manages a network of 4 treatment plants connected by pipes with known capacities. They need to deliver 500 gallons/hour to a new district. The flow through each pipe is constrained by linear equations based on conservation at each junction.",
                    "question": "Set up the system of linear equations for flow conservation at each junction node. What method would you use to determine if the network can meet the demand?",
                },
                created_at=NOW - timedelta(days=7),
            ),
            Activity(
                id=5,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="feynman",
                title="Teach: Elementary Row Operations",
                difficulty=1,
                target_claim_ids=["claim_rr_01"],
                payload={
                    "concept": "Elementary Row Operations",
                    "prompt": "Explain in your own words why elementary row operations do not change the solution set of a system of linear equations. Use an analogy if it helps.",
                    "key_points": ["Row operations are reversible", "They represent valid algebraic manipulations", "The augmented matrix encodes the same system"],
                },
                created_at=NOW - timedelta(days=6),
            ),
            Activity(
                id=6,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="mini_podcast",
                title="Mini Podcast: Determinants",
                difficulty=2,
                target_claim_ids=["claim_det_01", "claim_det_02"],
                payload={
                    "summary": "The determinant is a scalar value computed from a square matrix that encodes key geometric and algebraic properties. A nonzero determinant means the matrix is invertible, the columns are linearly independent, and the associated transformation preserves dimension. The determinant can be computed via cofactor expansion along any row or column, or by reducing to triangular form and multiplying the diagonal entries.",
                    "question": "After listening, explain: what does a zero determinant tell you about the column vectors of the matrix?",
                },
                created_at=NOW - timedelta(days=5),
            ),
            Activity(
                id=7,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="true_false",
                title="True/False: RREF Uniqueness",
                difficulty=1,
                target_claim_ids=["claim_rr_03"],
                payload={
                    "statement": "Every matrix has exactly one reduced row echelon form (RREF).",
                    "correct_answer": True,
                },
                created_at=NOW - timedelta(days=5),
            ),
            Activity(
                id=8,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="flashcard",
                title="Flashcard: Partial Pivoting",
                difficulty=1,
                target_claim_ids=["claim_ge_02"],
                payload={
                    "front": "What is partial pivoting and why is it used?",
                    "back": "Partial pivoting selects the entry with the largest absolute value in the current column as the pivot, swapping rows if necessary. This reduces numerical error caused by dividing by small numbers.",
                },
                created_at=NOW - timedelta(days=4),
            ),
            Activity(
                id=9,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="multi_choice",
                title="Multiple Choice: Matrix Inverses",
                difficulty=2,
                target_claim_ids=["claim_mi_01"],
                payload={
                    "question": "Which statement is correct about matrix invertibility?",
                    "options": [
                        "Only square matrices can be invertible, and they must have full rank.",
                        "Any matrix with full rank is invertible, regardless of shape.",
                        "A matrix is invertible if it has more rows than columns.",
                        "Rectangular matrices are always invertible if they have no zero rows.",
                    ],
                    "correct_index": 0,
                },
                created_at=NOW - timedelta(days=3),
            ),
            Activity(
                id=10,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="fill_blank",
                title="Fill in the Blank: Eigenvalues",
                difficulty=2,
                target_claim_ids=["claim_eig_01"],
                payload={
                    "statement": "Eigenvalues are the roots of det(A − ____) = 0.",
                    "correct_answer": "λI",
                },
                created_at=NOW - timedelta(days=2),
            ),
            Activity(
                id=11,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="feynman",
                title="Teach: Orthogonal Projection",
                difficulty=2,
                target_claim_ids=["claim_orth_01"],
                payload={
                    "concept": "Orthogonal Projection",
                    "prompt": "Explain in simple terms what it means to project a vector onto a subspace and why orthonormal bases make this easy.",
                    "key_points": ["Projection finds the closest point in the subspace", "Orthonormal bases let you use dot products directly", "The error vector is perpendicular to the subspace"],
                },
                created_at=NOW - timedelta(days=1),
            ),
            Activity(
                id=12,
                workspace_id=1,
                creator_id="usr_student_demo",
                scope="STUDENT_PERSONAL",
                type="wrong_on_purpose",
                title="Spot the Flaw: Gram-Schmidt",
                difficulty=2,
                target_claim_ids=["claim_orth_02"],
                payload={
                    "claim": "The description of Gram-Schmidt below is wrong. Find the error.",
                    "flawed_snippet": "Gram-Schmidt takes any set of vectors (even linearly dependent ones) and produces an orthonormal basis for Rⁿ.",
                    "prompt": "Identify what is wrong with this description of the Gram-Schmidt process.",
                },
                created_at=NOW - timedelta(days=1),
            ),
            # Teacher-broadcast activity
            Activity(
                id=13,
                workspace_id=2,
                creator_id="usr_teacher_demo",
                classroom_id=1,
                scope="CLASSROOM_BROADCAST",
                type="quiz",
                title="Week 3 Check-in: Gaussian Elimination",
                difficulty=2,
                target_claim_ids=["claim_ge_01", "claim_ge_02"],
                payload={
                    "question_count": 3,
                    "questions": [
                        {"index": 0, "type": "multi_choice", "claim_id": "claim_ge_01", "prompt": "In forward elimination, columns are processed in which order?", "options": ["Right to left", "Left to right", "Random order", "Diagonal first"], "correct_index": 1},
                        {"index": 1, "type": "true_false", "claim_id": "claim_ge_02", "prompt": "Partial pivoting selects the smallest nonzero entry as the pivot.", "correct_answer": False},
                        {"index": 2, "type": "short_answer", "claim_id": "claim_ge_01", "prompt": "Explain why forward elimination processes columns left to right."},
                    ],
                },
                created_at=NOW - timedelta(days=4),
            ),
        ]
        for act in activities:
            db.merge(act)

        db.flush()

        # Queue entries + attempts for the student
        queue_data = [
            (1, True, NOW - timedelta(days=9)),
            (2, True, NOW - timedelta(days=8)),
            (3, True, NOW - timedelta(days=7)),
            (5, True, NOW - timedelta(days=5)),
            (7, True, NOW - timedelta(days=4)),
            (8, True, NOW - timedelta(days=3)),
            (4, False, None),
            (6, False, None),
            (9, False, None),
            (10, False, None),
            (11, False, None),
            (12, False, None),
            (13, False, None),
        ]
        for i, (act_id, completed, completed_at) in enumerate(queue_data, start=1):
            db.merge(UserActivityQueue(
                id=i,
                user_id="usr_student_demo",
                activity_id=act_id,
                is_completed=completed,
                completed_at=completed_at,
                added_at=NOW - timedelta(days=10),
            ))

        attempts = [
            ActivityAttempt(
                id=1,
                user_id="usr_student_demo",
                activity_id=2,
                claim_id="claim_rr_01",
                outcome="understood",
                student_response="Multiply two rows together is not a valid row operation.",
                feedback="Correct! The three EROs are swap, scale, and add-a-multiple.",
                xp_awarded=15,
                rating_change=1,
                difficulty=1,
                attempted_at=NOW - timedelta(days=8),
            ),
            ActivityAttempt(
                id=2,
                user_id="usr_student_demo",
                activity_id=5,
                claim_id="claim_rr_01",
                outcome="understood",
                student_response="Row operations are like balancing both sides of an equation — you do the same thing to every term so the solution doesn't change.",
                feedback="Great analogy! Each ERO is reversible, which is why the solution set is preserved.",
                xp_awarded=20,
                rating_change=1,
                difficulty=1,
                attempted_at=NOW - timedelta(days=5),
            ),
            ActivityAttempt(
                id=3,
                user_id="usr_student_demo",
                activity_id=3,
                claim_id="claim_mi_01",
                outcome="understood",
                student_response="AAᵀ = I only if A is orthogonal, not just symmetric. The matrix [[2,1],[1,2]] is symmetric but AAᵀ = [[5,4],[4,5]] ≠ I.",
                feedback="Exactly right. Symmetry (A = Aᵀ) is different from orthogonality (AAᵀ = I).",
                xp_awarded=25,
                rating_change=1,
                difficulty=2,
                attempted_at=NOW - timedelta(days=7),
            ),
            ActivityAttempt(
                id=4,
                user_id="usr_student_demo",
                activity_id=7,
                claim_id="claim_rr_03",
                outcome="understood",
                student_response="True",
                feedback="Correct — RREF is unique for any matrix.",
                xp_awarded=10,
                rating_change=1,
                difficulty=1,
                attempted_at=NOW - timedelta(days=4),
            ),
            ActivityAttempt(
                id=5,
                user_id="usr_student_demo",
                activity_id=8,
                claim_id="claim_ge_02",
                outcome="did_not_understand",
                student_response="Partial pivoting picks the first nonzero entry.",
                feedback="Not quite — partial pivoting selects the entry with the largest absolute value, not just any nonzero entry. This minimizes numerical error.",
                xp_awarded=0,
                rating_change=-1,
                difficulty=1,
                attempted_at=NOW - timedelta(days=3),
            ),
        ]
        for att in attempts:
            db.merge(att)

        # ── 1f. Chat session ─────────────────────────────────────────────
        db.merge(ChatSession(
            id=1,
            user_id="usr_student_demo",
            workspace_id=1,
            title="Gaussian Elimination Help",
            created_at=NOW - timedelta(days=6),
        ))
        chat_messages = [
            ChatMessage(
                id=1,
                session_id=1,
                role="user",
                content="I'm confused about the difference between row echelon form and reduced row echelon form. Can you explain?",
                created_at=NOW - timedelta(days=6, hours=23),
            ),
            ChatMessage(
                id=2,
                session_id=1,
                role="assistant",
                content="Great question! Both are forms you get by applying elementary row operations, but they differ in strictness:\n\n**Row Echelon Form (REF):**\n- All zero rows at the bottom\n- Each pivot is to the right of the pivot above\n- All entries below each pivot are zero\n\n**Reduced Row Echelon Form (RREF):**\n- Everything in REF, plus:\n- Each pivot is exactly 1\n- Each pivot is the *only* nonzero entry in its column (zeros above AND below)\n\nThe key difference: REF is not unique (many valid REFs exist for one matrix), but RREF is unique.",
                sources={"claim_ids": ["claim_rr_02", "claim_rr_03"]},
                created_at=NOW - timedelta(days=6, hours=22, minutes=59),
            ),
            ChatMessage(
                id=3,
                session_id=1,
                role="user",
                content="Oh that makes sense. So when I'm doing Gaussian elimination, do I always need to go all the way to RREF?",
                created_at=NOW - timedelta(days=6, hours=22, minutes=55),
            ),
            ChatMessage(
                id=4,
                session_id=1,
                role="assistant",
                content="Not necessarily! It depends on your goal:\n\n- **Just need REF?** Stop after forward elimination. Then use back substitution to find the solution. This is standard Gaussian elimination.\n\n- **Need RREF?** Continue with backward elimination (also called Gauss-Jordan elimination) to clear entries above each pivot too. The solution can then be read directly from the matrix.\n\nIn practice, REF + back substitution is often faster computationally, but RREF is cleaner for reading off solutions — especially when you have free variables (infinitely many solutions).",
                sources={"claim_ids": ["claim_ge_01"]},
                created_at=NOW - timedelta(days=6, hours=22, minutes=54),
            ),
            ChatMessage(
                id=5,
                session_id=1,
                role="user",
                content="What about partial pivoting? When does that matter?",
                created_at=NOW - timedelta(days=6, hours=22, minutes=50),
            ),
            ChatMessage(
                id=6,
                session_id=1,
                role="assistant",
                content="Partial pivoting matters when you're working with actual numbers on a computer (floating-point arithmetic).\n\nThe idea: before eliminating in a column, swap rows so that the entry with the **largest absolute value** becomes the pivot. Why?\n\n- If the pivot is very small (close to zero), dividing by it creates huge multipliers\n- Those large multipliers amplify tiny rounding errors\n- After many steps, the accumulated error can make the answer meaningless\n\nFor hand calculations in a class, it rarely matters. But in real software (MATLAB, NumPy), partial pivoting is always used — it's essential for numerical stability.",
                sources={"claim_ids": ["claim_ge_02"]},
                created_at=NOW - timedelta(days=6, hours=22, minutes=49),
            ),
        ]
        for msg in chat_messages:
            db.merge(msg)

        # ── 1g. Glossary terms ───────────────────────────────────────────
        glossary = [
            ("Pivot", "The first nonzero entry in each row of a matrix in echelon form. Pivots determine the structure of the solution set."),
            ("Row Echelon Form", "A matrix form where all zero rows are at the bottom, each leading entry is to the right of the one above, and all entries below pivots are zero."),
            ("RREF", "Reduced Row Echelon Form — a unique canonical form where each pivot is 1 and is the only nonzero entry in its column."),
            ("Elementary Row Operation", "One of three operations: row swap, scalar multiplication of a row, or adding a scalar multiple of one row to another. These preserve the solution set."),
            ("Eigenvalue", "A scalar λ such that Ax = λx for some nonzero vector x. Found by solving det(A − λI) = 0."),
            ("Eigenvector", "A nonzero vector x satisfying Ax = λx for eigenvalue λ. Eigenvectors define directions that are only scaled (not rotated) by the linear transformation."),
            ("Determinant", "A scalar value computed from a square matrix. det(A) ≠ 0 iff A is invertible. Geometrically, it measures the signed volume scaling factor of the transformation."),
            ("Singular Value Decomposition", "A factorization A = UΣVᵀ that exists for any m×n matrix. U and V are orthogonal, Σ is diagonal with nonnegative singular values."),
            ("Orthogonal", "Two vectors are orthogonal if their dot product is zero. An orthogonal matrix Q satisfies QᵀQ = I."),
            ("Subspace", "A subset of a vector space that contains the zero vector and is closed under addition and scalar multiplication."),
        ]
        for i, (term, definition) in enumerate(glossary, start=1):
            db.merge(GlossaryTerm(
                id=i,
                workspace_id=1,
                source_document_id=1,
                term=term,
                definition=definition,
                source_ref={"text_excerpt": f"See Lay's Linear Algebra, relevant chapter."},
                is_auto_extracted=True,
                created_at=NOW - timedelta(days=20),
            ))

        db.commit()
        print("✓ Seed data inserted: 3 users, 2 workspaces, 1 classroom, 8 topics, 17 claims,")
        print("  17 mastery records, 13 activities, 5 attempts, 6 chat messages, 10 glossary terms,")
        print("  1 source document.")


if __name__ == "__main__":
    if not settings.run_seed_on_startup:
        print("Seed skipped: RUN_SEED_ON_STARTUP is false.")
    else:
        seed()
