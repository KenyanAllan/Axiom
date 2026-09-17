# Show Your Work Grading - Implementation Plan

**Objective:** Enable a compound grading mode where students upload photos of handwritten work (proofs, derivations, graph drawings, circuit diagrams) and the system provides structured feedback by combining Amazon Rekognition's structural detection with Claude Vision's holistic understanding. This differs from the Visual Activity Types feature (04) in that it applies to *any* activity type — a student can "show their work" on a feynman explanation, a fill-in-the-blank, or even a multiple-choice justification.

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Response format | Text-only for all activity types | Any activity can accept an optional image attachment as supplementary evidence |
| Grading pipeline | Text-based deterministic or Bedrock grading | Hybrid: text grading + optional visual verification via Rekognition + Claude Vision |
| Student work visibility | Only final answer string stored | Full handwritten work preserved in S3, viewable by student and teacher |
| Feedback quality | "Correct" / "Incorrect" + text feedback | Structured visual feedback: "Your tree structure is correct but the edge labels are swapped at node 7" |
| Teacher review | Teachers see text responses only | Teachers can view student's photographed work alongside the grading result |

**Technical Prerequisites & Dependencies:**

- **Feature 01 (Image Source Ingestion)**: Rekognition service module (`rekognition.py`) must exist.
- **Feature 04 (Visual Activity Types)**: The `response_image_s3_key` column on `activity_attempts` must exist (from migration in Feature 04). If Feature 04 is not yet built, include that migration here.
- **Bedrock multimodal**: Claude Vision for grading (same as Feature 04).
- **No new infrastructure**: Uses existing S3, Rekognition, and Bedrock.

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Migration (if Feature 04 not yet built)**

Ensure `activity_attempts` has:
```python
response_image_s3_key = Column(String, nullable=True)
```

Additionally, add a `work_analysis` JSONB column for storing structured visual feedback:

```python
def upgrade():
    op.add_column("activity_attempts", sa.Column("work_analysis", JSONB, nullable=True))
    # Only if Feature 04 not done:
    # op.add_column("activity_attempts", sa.Column("response_image_s3_key", sa.String(), nullable=True))

def downgrade():
    op.drop_column("activity_attempts", "work_analysis")
```

**1b. Update ORM model** — `backend/app/models/tables.py`

```python
class ActivityAttempt(Base):
    ...
    response_image_s3_key = Column(String, nullable=True)  # from Feature 04 or here
    work_analysis = Column(JSONB, nullable=True)  # structured visual grading result
```

The `work_analysis` JSONB stores:

```json
{
  "rekognition_labels": [{"Name": "Diagram", "Confidence": 95.2}, ...],
  "detected_text": ["node A", "edge B->C", ...],
  "structural_elements": {
    "nodes_detected": 5,
    "text_labels_detected": 8,
    "has_arrows": true,
    "has_mathematical_notation": true
  },
  "claude_vision_assessment": {
    "work_quality": "thorough",
    "errors_found": ["Edge between nodes 3 and 7 is drawn in wrong direction"],
    "strengths": ["Correct node placement", "Clear labeling"],
    "suggestion": "Double-check the direction of edges — remember BFS explores level by level"
  }
}
```

**1c. Update evaluation endpoint to accept optional image** — `backend/app/api/routes/activities.py`

Modify the existing submission endpoint (or the general `evaluate` endpoint) to accept an optional image alongside the text response:

```python
@router.post("/{activity_id}/submit")
async def submit_response(
    activity_id: int,
    student_response: str = Form(...),
    work_image: UploadFile | None = File(default=None),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Submit a response with optional 'show your work' image.
    If work_image is provided:
      1. Upload to S3: work-images/{user_id}/{activity_id}/{uuid}.{ext}
      2. Run visual analysis (Rekognition + Claude Vision)
      3. Store analysis in work_analysis JSONB
      4. Use visual insights to enhance text grading
    Then proceed with normal evaluation pipeline.
    """
```

**1d. Create work analysis service** — `backend/app/services/work_analysis.py`

```python
# New file: backend/app/services/work_analysis.py

async def analyze_student_work(
    image_bytes: bytes,
    activity_type: str,
    claim_content: str,
    student_text_response: str,
    activity_payload: dict,
) -> dict:
    """Full visual analysis of student's submitted work image.

    Steps:
    1. Rekognition DetectLabels → classify image content
    2. Rekognition DetectText → extract handwritten/printed text from image
    3. Claude Vision → holistic assessment against the claim and rubric
    4. Cross-reference: compare Claude's reading of the work with the student's
       typed text response for consistency

    Returns work_analysis dict (stored in ActivityAttempt.work_analysis).
    """

def _rekognition_analysis(image_bytes: bytes) -> dict:
    """Structural detection via Rekognition.
    Returns: labels, detected_text, structural_elements summary."""

def _claude_vision_assessment(
    image_bytes: bytes,
    claim_content: str,
    activity_type: str,
    rubric: str,
) -> dict:
    """Claude Vision holistic grading.
    Prompt instructs Claude to:
    - Describe what the student drew/wrote
    - Identify specific errors with locations
    - Note strengths
    - Suggest improvements
    Returns: work_quality, errors_found, strengths, suggestion."""
```

**1e. Integrate visual analysis into evaluation** — `backend/app/services/evaluation.py`

In `evaluate_student_response`, after determining the text-based outcome:

```python
# After text-based grading:
work_analysis = None
if hasattr(attempt, 'response_image_s3_key') and attempt.response_image_s3_key:
    from app.services.work_analysis import analyze_student_work
    from app.services.ingestion import download_from_s3

    image_bytes = await asyncio.to_thread(download_from_s3, attempt.response_image_s3_key)
    work_analysis = await analyze_student_work(
        image_bytes=image_bytes,
        activity_type=activity_type or "",
        claim_content=claim.content,
        student_text_response=student_response,
        activity_payload=(activity_obj.payload or {}) if activity_obj else {},
    )
    attempt.work_analysis = work_analysis

    # Enhance feedback with visual insights:
    if work_analysis.get("claude_vision_assessment", {}).get("errors_found"):
        errors = work_analysis["claude_vision_assessment"]["errors_found"]
        feedback += "\n\nLooking at your work: " + "; ".join(errors)

    # Upgrade outcome if work shows understanding despite wrong text answer:
    if outcome == "did_not_understand" and work_analysis.get("claude_vision_assessment", {}).get("work_quality") == "thorough":
        outcome = "neutral"
        feedback += "\n\nYour written work shows good reasoning even though the final answer wasn't correct."
```

**1f. Add teacher work review endpoint** — `backend/app/api/routes/activities.py`

```python
@router.get("/{activity_id}/attempts/{attempt_id}/work")
async def get_student_work(
    activity_id: int,
    attempt_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Teachers can view a student's submitted work image and analysis.
    Returns: presigned_url for the image, work_analysis JSONB, outcome, feedback."""
```

#### 2. Frontend / UI Changes

**2a. "Show Your Work" toggle on activity cards**

On every activity submission form, add an optional "Show your work" section:
- Collapsed by default with a camera icon and "Attach your work (optional)"
- On click, expands to show upload area (click or drag) + camera capture on mobile
- Thumbnail preview of staged image with remove button

**2b. Update submission flow**

When submitting with an image:
1. Upload image to S3 via a dedicated endpoint
2. Include the S3 key in the submission payload
3. Show a loading state: "Analyzing your work..." (visual analysis takes longer than text grading)

**2c. Enhanced feedback display**

After grading, if `work_analysis` is present:
- Show the student's submitted image
- Overlay or list the detected errors from `claude_vision_assessment.errors_found`
- Show strengths as positive callouts
- Show the suggestion as an action item

**2d. Teacher dashboard: work review**

In the teacher's class view, add a "View Work" button on each student attempt that has `response_image_s3_key`. Opens a modal showing:
- Student's photographed work (presigned URL)
- Rekognition-detected labels and text
- Claude Vision assessment summary
- Grading outcome and feedback

#### 3. Integration Points

- **Evaluation pipeline**: `work_analysis` integrates directly — it can upgrade/downgrade the outcome based on visual evidence. The XP, rating change, and streak systems all react to the adjusted outcome.
- **Persistent tutor memory (Feature 06)**: Visual grading results feed into misconception detection. If Claude Vision repeatedly finds the same error type (e.g., "wrong edge direction"), that becomes a tagged misconception in DynamoDB.
- **Activity queue**: No changes — "show your work" is optional on any activity. The queue doesn't need to know whether the student will attach an image.
- **Chat integration**: The tutor can reference work_analysis from previous attempts: "I noticed in your last submission that you drew the edges backwards — let's work on that."

---

### Edge Cases & Failure Modes

- **No image submitted**: The feature is entirely optional. When `work_image` is None, the standard text-only grading pipeline runs exactly as today. Zero behavior change for users who don't use it.
- **Image analysis timeout**: Claude Vision + Rekognition analysis may take 5-10 seconds. Set a timeout of 30 seconds. If exceeded, grade based on text response only and return `work_analysis = null` with a note: "Visual analysis timed out — graded based on your text response."
- **Inconsistency between text and image**: Student types "BFS uses a queue" (correct) but their drawn diagram shows a stack. The `cross-reference` step in `analyze_student_work` detects this and adds a note: "Your typed answer is correct but your diagram shows a stack — make sure your mental model matches."
- **Illegible handwriting**: Claude Vision returns low-confidence assessment. Return feedback: "I had trouble reading parts of your work. For better feedback, try writing more clearly or use a thicker pen."
- **Multiple pages of work**: Accept only one image per submission. If students need multiple pages, suggest using a scanner app to combine into a single image, or submit their best/most relevant page.
- **Image manipulation**: A student could submit someone else's work. This is a policy issue, not a technical one. The system stores the image for teacher review, providing an audit trail.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: `analyze_student_work` returns a valid `work_analysis` dict with all required fields.
- [ ] **Unit test**: `_rekognition_analysis` returns `structural_elements` with `nodes_detected`, `text_labels_detected`, etc.
- [ ] **Unit test**: `_claude_vision_assessment` returns `errors_found`, `strengths`, and `suggestion`.
- [ ] **Integration test**: Submit a fill_blank activity with a work image → verify `ActivityAttempt` has both `student_response` and `response_image_s3_key` and `work_analysis` populated.
- [ ] **Integration test**: Submit without an image → verify standard grading runs and `work_analysis` is null.
- [ ] **Integration test**: Submit with an image showing correct work but wrong text answer → verify outcome is upgraded to "neutral" with appropriate feedback.
- [ ] **Integration test**: Teacher fetches `GET /activities/{id}/attempts/{id}/work` → verify presigned URL and work_analysis returned.
- [ ] **Frontend test**: "Show your work" section is collapsed by default and expands on click.
- [ ] **Frontend test**: Image upload preview appears and can be removed before submission.
- [ ] **Frontend test**: Loading state shows "Analyzing your work..." during visual grading.
- [ ] **Frontend test**: Enhanced feedback shows errors and strengths from work_analysis.
- [ ] **Manual QA**: Complete a feynman activity + attach a photo of handwritten explanation → verify Claude Vision references specific parts of the handwritten work in feedback.
- [ ] **Manual QA**: Submit a blurry image → verify graceful feedback about illegibility.
- [ ] **Manual QA (teacher)**: View a student's submitted work in the teacher dashboard → verify image and analysis are displayed.
