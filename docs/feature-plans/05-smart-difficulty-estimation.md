# Smart Difficulty Estimation - Implementation Plan

**Objective:** Automatically estimate the difficulty of ingested source material using Amazon Comprehend's syntax analysis, without additional LLM calls. Each topic and claim receives a computed `complexity_score` (1-5) based on syntactic complexity, vocabulary density, and sentence structure. This score feeds into the DAG to pre-sort topics by difficulty and calibrate activity generation.

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Topic difficulty | Implicit — inferred only from student mastery progression | Explicit `complexity_score` (1-5) computed at ingestion time via Comprehend |
| Claim difficulty | None — all claims treated as equal weight | Per-claim `complexity_score` based on syntactic analysis of `content` |
| Activity difficulty | Derived from `_compute_difficulty` using average `understanding_rating` (student-relative) | Combines student mastery AND intrinsic claim complexity for a blended difficulty |
| DAG ordering | Topological sort by prerequisite edges only | Topological sort with complexity-weighted tie-breaking (easier topics surface first at the same depth) |
| Ingestion cost | 2 Bedrock calls per chunk (topic extraction + glossary) | Adds 1 Comprehend call per chunk (syntax analysis) — orders of magnitude cheaper than Bedrock |

**Technical Prerequisites & Dependencies:**

- **AWS IAM**: Add `ComprehendReadOnly` (or `comprehend:DetectSyntax`, `comprehend:DetectKeyPhrases`) to `EC2InstanceRole` in `cloudformation.yaml`.
- **Alembic migration**: Add `complexity_score` (Float) to `topics` and `atomic_claims` tables.
- **No new pip dependencies**: `boto3` already includes the Comprehend client.
- **Settings**: Add `comprehend_language_code` to `config.py` (default: `"en"`).

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Alembic migration — complexity scores**

```python
def upgrade():
    op.add_column("topics", sa.Column("complexity_score", sa.Float(), nullable=True))
    op.add_column("atomic_claims", sa.Column("complexity_score", sa.Float(), nullable=True))

def downgrade():
    op.drop_column("topics", "complexity_score")
    op.drop_column("atomic_claims", "complexity_score")
```

**1b. Update ORM models** — `backend/app/models/tables.py`

```python
class Topic(Base):
    ...
    complexity_score = Column(Float, nullable=True)  # 1.0-5.0

class AtomicClaim(Base):
    ...
    complexity_score = Column(Float, nullable=True)  # 1.0-5.0
```

**1c. Create Comprehend service** — `backend/app/services/comprehend.py`

```python
# New file: backend/app/services/comprehend.py

_comprehend_client = None

def _get_comprehend_client():
    """Lazy singleton following existing pattern."""

def analyze_syntax(text: str, language_code: str = "en") -> dict:
    """Call Comprehend DetectSyntax.
    Returns part-of-speech tag distribution and token count.
    Max 5000 bytes per call — truncate or chunk if needed."""

def detect_key_phrases(text: str, language_code: str = "en") -> list[dict]:
    """Call Comprehend DetectKeyPhrases.
    Returns key phrases with confidence scores.
    Used to measure technical term density."""

def compute_complexity_score(text: str, language_code: str = "en") -> float:
    """Compute a 1.0-5.0 complexity score based on multiple signals:

    Signals:
    1. Average sentence length (words per sentence)
       - < 12 words: low complexity
       - 12-20: medium
       - > 20: high
    2. Part-of-speech diversity (unique POS tags / total tokens)
       - Higher diversity → more complex sentence structures
    3. Noun phrase density (key phrases per sentence)
       - More noun phrases → more concepts packed per sentence
    4. Rare POS tag ratio (subordinating conjunctions, past participles, etc.)
       - These indicate complex clause structures
    5. Average word length (proxy for vocabulary sophistication)
       - Technical terms tend to be longer

    Formula:
        raw = 0.25 * sentence_length_factor
            + 0.20 * pos_diversity_factor
            + 0.20 * noun_phrase_density_factor
            + 0.20 * rare_pos_factor
            + 0.15 * word_length_factor

    Clamped to [1.0, 5.0] and rounded to 1 decimal.
    """
```

**1d. Integrate into ingestion pipeline** — `backend/app/services/ingestion.py`

After extracting topic + claims for each chunk (line ~600), compute complexity:

```python
from app.services.comprehend import compute_complexity_score

# After extraction, before creating/merging topic:
chunk_complexity = compute_complexity_score(chunk["text"])

# Apply to topic (average across chunks that contribute to this topic):
if topic.complexity_score is None:
    topic.complexity_score = chunk_complexity
else:
    topic.complexity_score = (topic.complexity_score + chunk_complexity) / 2

# Apply to each claim:
for claim_data in claims_data:
    claim_text = claim_data.get("content", "")
    claim_complexity = compute_complexity_score(claim_text) if claim_text else chunk_complexity
    # Store on the claim object:
    claim.complexity_score = claim_complexity
```

**1e. Update activity difficulty computation** — `backend/app/services/activity_generator.py`

Modify `_compute_difficulty` to blend student mastery with intrinsic complexity:

```python
async def _compute_difficulty(
    db: AsyncSession,
    user_id: str | None,
    claim_ids: list[str],
) -> int:
    """Blended difficulty: student mastery + intrinsic claim complexity.

    intrinsic_difficulty: average complexity_score of target claims (1-5 scale → mapped to 1-3)
    mastery_difficulty: existing logic (understanding_rating → 1-3)
    blended = 0.4 * intrinsic_difficulty + 0.6 * mastery_difficulty
    """
    # Existing mastery-based logic...
    mastery_diff = ...  # 1, 2, or 3

    # New: intrinsic complexity
    result = await db.execute(
        select(AtomicClaim.complexity_score).where(
            AtomicClaim.id.in_(claim_ids),
            AtomicClaim.complexity_score.isnot(None),
        )
    )
    scores = [r[0] for r in result.all()]
    if scores:
        avg_complexity = sum(scores) / len(scores)
        # Map 1-5 → 1-3
        intrinsic_diff = 1 + (avg_complexity - 1) * 0.5  # 1→1, 3→2, 5→3
        intrinsic_diff = max(1, min(3, intrinsic_diff))
    else:
        intrinsic_diff = mastery_diff  # fallback

    blended = 0.4 * intrinsic_diff + 0.6 * mastery_diff
    return max(1, min(3, round(blended)))
```

**1f. Update DAG frontier ordering** — `backend/app/services/dag.py`

In `compute_frontier`, after filtering topics by prerequisite mastery, sort frontier topics by `complexity_score` ascending (easier first):

```python
# In compute_frontier, after collecting frontier topics:
frontier_topics.sort(key=lambda t: t.complexity_score or 3.0)  # default to middle
```

**1g. Update config** — `backend/app/core/config.py`

```python
# Amazon Comprehend
comprehend_language_code: str = "en"
```

#### 2. Frontend / UI Changes

**2a. Display complexity badge on topics**

In the topic list view, show a small difficulty indicator (color-coded dot or label):
- 1.0-2.0: Green "Beginner"
- 2.1-3.5: Yellow "Intermediate"
- 3.6-5.0: Red "Advanced"

**2b. Display complexity in DAG visualization** (if one exists)

If the frontend has a topic graph/DAG view, color-code nodes by complexity score.

**2c. Expose complexity in the mastery status tool response**

Update `_tool_mastery` in `tool_executor.py` to include `complexity_score` in each claim's data, so the chat tutor can say: "This topic is rated as Advanced — let's build up to it."

#### 3. Integration Points

- **Learning frontier**: The `get_learning_frontier` tool now returns topics sorted by complexity. The AI tutor can recommend "Start with [easier topic] before tackling [harder topic]."
- **Activity generation**: Activities for high-complexity claims start at higher base difficulty, giving the student appropriately challenging questions from the beginning.
- **Audio overview**: The `generate_audio_overview` tool could mention topic complexity in its script: "This is an advanced topic, so let's break it down carefully..."
- **Ingestion stats**: Add `avg_complexity` to the `stats` dict returned by `ingest_source_document` and stored in `SourceDocument.metadata_`.

---

### Edge Cases & Failure Modes

- **Comprehend API failure**: Wrap in try/except. On failure, default `complexity_score = None` (treated as medium/3.0 in downstream logic). Never block ingestion on Comprehend failure.
- **Very short text (<50 chars)**: Comprehend's syntax analysis is less reliable on very short inputs. For claims with `content` shorter than 50 characters, skip Comprehend and default to the chunk-level complexity score.
- **Non-English text**: Comprehend supports many languages for syntax analysis. If using the multilingual platform (Feature 03), pass the detected language code instead of hardcoding `"en"`. Falls back to `"en"` if the language is unsupported.
- **Comprehend text size limit**: `DetectSyntax` has a 5000-byte limit. For chunks exceeding this, analyze only the first 5000 bytes. This is acceptable since the beginning of a section is usually representative of its complexity.
- **Cost**: Comprehend pricing is $0.0001 per unit (100 characters) for syntax. A typical ingestion of 20 chunks × 800 tokens × 4 chars = 64,000 characters = ~$0.06. Negligible compared to Bedrock calls.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: `compute_complexity_score("The cat sat on the mat.")` returns a score in range [1.0, 2.5] (simple sentence).
- [ ] **Unit test**: `compute_complexity_score("The eigenvalues of a Hermitian matrix are real, which follows from the spectral theorem applied to self-adjoint operators on finite-dimensional inner product spaces.")` returns a score in range [3.5, 5.0].
- [ ] **Unit test**: `compute_complexity_score` handles empty string → returns 3.0 (default).
- [ ] **Integration test**: Ingest a source document → verify `Topic.complexity_score` and `AtomicClaim.complexity_score` are populated with values in [1.0, 5.0].
- [ ] **Integration test**: `compute_frontier` returns topics sorted by complexity ascending.
- [ ] **Integration test**: `_compute_difficulty` produces different activity difficulties for a claim with `complexity_score = 1.5` vs. `complexity_score = 4.5` when mastery is equal.
- [ ] **Frontend test**: Topic list shows complexity badges with correct color coding.
- [ ] **Manual QA**: Ingest a simple introductory text and a complex research paper → verify the simple text's topics have lower complexity scores.
- [ ] **Manual QA**: Verify the learning frontier recommends easier topics before harder ones at the same DAG depth.
