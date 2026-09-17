# Persistent Tutor Memory - Implementation Plan

**Objective:** Give the AI tutor persistent memory of each student's learning patterns, recurring misconceptions, and conversation history across chat sessions using Amazon Bedrock AgentCore Memory and DynamoDB. The tutor recalls what a student struggled with last week and proactively addresses it: "Last time you confused BFS and DFS — let's revisit that."

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Cross-session context | None — each chat session starts fresh. Last 10 messages of the *current* session only | Tutor recalls student-specific patterns, misconceptions, and progress across all sessions |
| Misconception tracking | Implicit in `UserMastery.history` (JSONB array of attempt records) | Explicit misconception store: identified patterns, specific confusions, recurring errors |
| Student model | `UserMastery` tracks rating (1-5) and status per claim | Enriched with learning velocity, time-to-mastery estimates, and misconception tags |
| Chat system prompt | Static `RAG_SYSTEM_PROMPT` identical for every student | Personalized preamble injected per student with their known misconceptions and learning style |
| Data store | PostgreSQL only | DynamoDB for ultra-low-latency reads of student state during chat; PostgreSQL remains the system of record |

**Technical Prerequisites & Dependencies:**

- **Amazon DynamoDB**: New table `axiom-student-memory` for per-student learning profiles. Requires `AmazonDynamoDBFullAccess` on the `EC2InstanceRole`.
- **Amazon Bedrock AgentCore Memory** (optional enhancement): If AgentCore is available, use its built-in session memory for multi-turn Socratic dialogues. Falls back to DynamoDB-only if AgentCore is not configured.
- **Alembic migration**: Add `misconceptions` JSONB to `user_mastery` and `learning_profile` JSONB to `users`.
- **No new pip dependencies**: `boto3` includes the DynamoDB client. Consider `boto3.resource("dynamodb")` for higher-level API.

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. DynamoDB table creation** — `cloudformation.yaml`

```yaml
StudentMemoryTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub "axiom-student-memory-${AWS::StackName}"
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: student_id
        AttributeType: S
      - AttributeName: memory_key
        AttributeType: S
    KeySchema:
      - AttributeName: student_id
        KeyType: HASH
      - AttributeName: memory_key
        KeyType: RANGE
    TimeToLiveSpecification:
      AttributeName: ttl
      Enabled: true
```

Items stored per student:

```json
{
  "student_id": "usr_student_demo",
  "memory_key": "misconception:bfs_vs_dfs",
  "content": "Repeatedly confuses BFS (queue) and DFS (stack). In 3 of 5 attempts on claim_bfs_traversal, selected DFS behavior when asked about BFS.",
  "claim_ids": ["claim_bfs_traversal", "claim_dfs_traversal"],
  "severity": "high",
  "first_seen": "2026-09-10T14:00:00Z",
  "last_seen": "2026-09-16T10:30:00Z",
  "occurrence_count": 3,
  "resolved": false,
  "ttl": 1758000000
}
```

Memory key types:
- `misconception:{slug}` — specific conceptual confusion
- `strength:{topic_slug}` — strong topic performance
- `learning_style:{dimension}` — observed preferences (e.g., prefers visual examples, needs more practice before moving on)
- `velocity:{topic_slug}` — learning speed for a topic area

**1b. Alembic migration — PostgreSQL additions**

```python
def upgrade():
    op.add_column("users", sa.Column("learning_profile", JSONB, nullable=True, server_default="{}"))

def downgrade():
    op.drop_column("users", "learning_profile")
```

The `learning_profile` JSONB stores a snapshot summary (synced from DynamoDB periodically):

```json
{
  "active_misconceptions": ["bfs_vs_dfs", "off_by_one_loops"],
  "strong_topics": ["sorting_algorithms", "basic_data_types"],
  "learning_velocity": "moderate",
  "preferred_activity_types": ["feynman", "visual_sketch"],
  "last_profile_sync": "2026-09-17T00:00:00Z"
}
```

**1c. Create student memory service** — `backend/app/services/student_memory.py`

```python
# New file: backend/app/services/student_memory.py

_dynamo_table = None

def _get_table():
    """Lazy singleton for DynamoDB table resource."""

async def get_student_memories(student_id: str, prefix: str | None = None) -> list[dict]:
    """Fetch all memory items for a student, optionally filtered by key prefix.
    e.g., prefix='misconception:' returns only misconceptions."""

async def put_student_memory(student_id: str, memory_key: str, content: dict) -> None:
    """Upsert a memory item. Sets TTL to 90 days from now."""

async def delete_student_memory(student_id: str, memory_key: str) -> None:
    """Delete a resolved memory item."""

async def get_student_context_summary(student_id: str) -> str:
    """Build a text summary of the student's profile for injection into the system prompt.
    Reads from DynamoDB, formats as a paragraph:
    'This student has the following known misconceptions: ...
     They are strong in: ...
     They learn at a [fast/moderate/slow] pace.
     Previous sessions indicate they prefer [activity types].'
    """

async def analyze_and_update_misconceptions(
    student_id: str,
    claim_id: str,
    outcome: str,
    student_response: str,
    feedback: str,
    db: AsyncSession,
) -> None:
    """Called after every evaluation. Detects patterns:
    1. If the same claim gets 'did_not_understand' 3+ times → create misconception
    2. If a misconception's claim gets 'understood' 2 consecutive times → mark resolved
    3. Update occurrence_count and last_seen on existing misconceptions
    """
```

**1d. Integrate misconception detection into evaluation** — `backend/app/services/evaluation.py`

After the attempt is recorded (line ~218), call the misconception analyzer:

```python
# After db.add(attempt) and db.flush():
from app.services.student_memory import analyze_and_update_misconceptions

await analyze_and_update_misconceptions(
    student_id=user_id,
    claim_id=claim_id,
    outcome=outcome,
    student_response=student_response,
    feedback=feedback,
    db=db,
)
```

**1e. Inject student context into chat** — `backend/app/api/routes/chat.py`

Before calling `_rag_converse_with_tools`, fetch the student's memory summary:

```python
from app.services.student_memory import get_student_context_summary

student_context = await get_student_context_summary(user_id)

# Modify the system prompt dynamically:
personalized_system_prompt = RAG_SYSTEM_PROMPT
if student_context:
    personalized_system_prompt += f"\n\n## STUDENT PROFILE\n{student_context}"
```

Pass `personalized_system_prompt` into `_call_bedrock_converse` instead of the static `RAG_SYSTEM_PROMPT`:

```python
def _call_bedrock_converse(messages, tool_config=None, system_prompt=None):
    ...
    kwargs = {
        "system": [{"text": system_prompt or RAG_SYSTEM_PROMPT}],
        ...
    }
```

**1f. Update config** — `backend/app/core/config.py`

```python
# DynamoDB
dynamodb_student_memory_table: str = "axiom-student-memory"
dynamodb_memory_ttl_days: int = 90
```

**1g. Add profile sync background task** — `backend/app/workers/celery_app.py`

Add a periodic Celery Beat task that syncs DynamoDB memory summaries to the PostgreSQL `learning_profile`:

```python
@celery_app.task
def sync_student_profiles():
    """Runs daily. For each active student, reads DynamoDB memories
    and updates the PostgreSQL learning_profile JSONB snapshot."""
```

#### 2. Frontend / UI Changes

**2a. Student profile panel in Settings**

Display the student's learning profile: known misconceptions, strong topics, learning velocity. Read from the existing `/api/users/me` endpoint (which now includes `learning_profile`).

**2b. Misconception badges on topics**

In the topic list or DAG view, show a warning badge on topics where the student has active misconceptions.

**2c. "The tutor remembers" indicator in chat**

When the system prompt includes student context, show a small indicator in the chat header: "Personalized tutoring active" — so the student knows the tutor is adapting to them.

#### 3. Integration Points

- **Evaluation pipeline**: Every `evaluate_student_response` call triggers misconception analysis. This is the primary data source for student memory.
- **Learning frontier**: `compute_frontier` can deprioritize topics with active misconceptions in prerequisites (the student should resolve the misconception first).
- **Activity generation**: When generating activities for a topic with known misconceptions, the `generate_basic_activities` function can adjust the prompt to target the specific confusion.
- **Chat tools**: Add a new chat tool `get_my_misconceptions` that lets the student ask "What am I struggling with?" The tutor reads from DynamoDB and explains.

---

### Edge Cases & Failure Modes

- **DynamoDB unavailable**: All DynamoDB reads are wrapped in try/except. On failure, the chat proceeds with a static system prompt (no personalization). Log a warning but never block the chat flow.
- **Stale misconceptions**: TTL is set to 90 days. After 90 days without activity, memories expire automatically. The daily sync task also marks misconceptions as resolved if the student has mastered the related claims.
- **False positive misconceptions**: A student who gets 3 wrong answers in a row due to rushing (not true confusion) triggers a misconception. Mitigate by requiring: (a) 3+ failures AND (b) Bedrock feedback indicates conceptual confusion (not carelessness). Use the `feedback` text from grading to distinguish.
- **Privacy**: Student memory contains learning patterns but no PII beyond what's already in `UserMastery`. DynamoDB items are keyed by `student_id` and scoped to the student. No cross-student access.
- **DynamoDB cost**: PAY_PER_REQUEST billing. Typical student: ~50 reads/day (chat sessions) + ~20 writes/day (evaluations). At scale of 1000 students: ~70K requests/day ≈ $0.09/day. Negligible.
- **Cold start for new students**: The system prompt falls back to generic tutoring when no memory exists. As the student completes activities, the profile builds up organically.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: `analyze_and_update_misconceptions` creates a misconception after 3 consecutive `did_not_understand` outcomes on the same claim.
- [ ] **Unit test**: `analyze_and_update_misconceptions` resolves a misconception after 2 consecutive `understood` outcomes.
- [ ] **Unit test**: `get_student_context_summary` returns a formatted string with misconceptions and strengths.
- [ ] **Unit test**: `get_student_context_summary` returns empty string for a new student with no memory items.
- [ ] **Integration test**: Fail the same claim 3 times → verify DynamoDB item created with `memory_key = "misconception:{slug}"`.
- [ ] **Integration test**: Resolve a misconception → verify DynamoDB item marked `resolved: true`.
- [ ] **Integration test**: Start a chat session → verify system prompt includes student-specific context from DynamoDB.
- [ ] **Integration test**: DynamoDB unavailable → verify chat still works with generic system prompt and a warning is logged.
- [ ] **Frontend test**: Student profile panel displays active misconceptions and strong topics.
- [ ] **Manual QA**: Fail a claim repeatedly in Session A → start a new Session B → send a message about the topic → verify the tutor proactively mentions the previous struggle.
- [ ] **Manual QA**: Master a previously struggled claim → verify the tutor no longer mentions it as a misconception in subsequent sessions.
- [ ] **Manual QA**: New student with no history → verify the tutor works normally with no personalization artifacts.
