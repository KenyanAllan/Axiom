# Visual Activity Types - Implementation Plan

**Objective:** Add new activity types where students respond with images instead of text: "draw the graph structure," "sketch the circuit," "write the proof on paper and photograph it." The system grades visual submissions using Amazon Rekognition for structural detection and Claude Vision for holistic correctness evaluation.

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Activity types | flashcard, true_false, multi_choice, fill_blank, wrong_on_purpose, feynman | Adds `visual_sketch`, `visual_label`, `visual_proof` |
| Student responses | Text-only (`student_response: str` in `ActivityAttempt`) | Text or image (`response_image_s3_key` in `ActivityAttempt`) |
| Grading | Deterministic (multiple choice, etc.) or Bedrock text grading (feynman) | Adds Claude Vision multimodal grading + Rekognition structural verification |
| Activity generation | Claim-based text activities | Adds visual prompt generation with reference diagram/structure descriptions |
| Activity payload | Text fields (question, options, correct_answer) | Adds `visual_prompt` (what to draw), `expected_structure` (Rekognition validation criteria), `reference_description` (Claude Vision rubric) |

**Technical Prerequisites & Dependencies:**

- **Feature 02 (Multimodal Chat Tutoring)** is NOT required — this feature has its own image upload path via the activity submission endpoint.
- **Feature 01 (Image Source Ingestion)**: Rekognition service module (`rekognition.py`) should be built first. If not, this plan includes creating it.
- **Alembic migration**: Add `response_image_s3_key` to `activity_attempts`.
- **Bedrock multimodal**: Same Claude Converse API multimodal support used for grading (image + rubric → outcome).
- **Rekognition**: `detect_labels` to verify structural elements (nodes, edges, arrows, text labels).

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Alembic migration — image response support**

```python
def upgrade():
    op.add_column("activity_attempts", sa.Column("response_image_s3_key", sa.String(), nullable=True))

def downgrade():
    op.drop_column("activity_attempts", "response_image_s3_key")
```

**1b. Update ORM model** — `backend/app/models/tables.py`

```python
class ActivityAttempt(Base):
    ...
    response_image_s3_key = Column(String, nullable=True)
```

**1c. Define new activity types in `activity_generator.py`**

Add three new visual activity generators in `backend/app/services/activity_generator.py`:

```python
VISUAL_ACTIVITY_TYPES = {"visual_sketch", "visual_label", "visual_proof"}

# visual_sketch: "Draw the data structure described by this claim"
# Payload: {
#   "visual_prompt": "Draw a binary search tree with the values [5, 3, 7, 1, 4, 6, 8] inserted in order.",
#   "expected_structure": {"required_labels": ["5", "3", "7", "1", "4"], "expected_label_count_min": 5},
#   "reference_description": "A balanced BST with 5 as root, 3 and 7 as children, ..."
# }

# visual_label: "Label the components in this diagram"
# Payload: {
#   "visual_prompt": "The following diagram shows a linked list. Label each node and pointer.",
#   "reference_image_s3_key": "activities/visual/ref_linked_list.png",  # optional reference
#   "expected_labels": ["head", "node", "next", "null"],
#   "reference_description": "A singly linked list with head pointer, 3 nodes, and null terminator"
# }

# visual_proof: "Write out your proof/solution on paper and photograph it"
# Payload: {
#   "visual_prompt": "Prove by induction that the sum of first n natural numbers is n(n+1)/2.",
#   "reference_description": "A valid proof should include base case (n=1), inductive hypothesis, inductive step.",
#   "grading_rubric": "Check for: (1) base case, (2) clear inductive hypothesis, (3) algebraic manipulation in inductive step"
# }
```

Generate these via Bedrock when the claim content describes a structure, algorithm, or provable theorem:

```python
async def generate_visual_activity(
    db: AsyncSession,
    claim: AtomicClaim,
    workspace_id: int,
    creator_id: str,
    visual_type: str,  # "visual_sketch" | "visual_label" | "visual_proof"
) -> Activity:
    """Use Bedrock to generate the visual prompt and grading criteria from the claim."""
```

**1d. Add image submission endpoint** — `backend/app/api/routes/activities.py`

Add an endpoint for submitting visual activity responses with an image:

```python
@router.post("/{activity_id}/submit-visual")
async def submit_visual_response(
    activity_id: int,
    file: UploadFile = File(...),
    text_response: str = Form(default=""),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Submit a visual (image) response for a visual activity type.
    1. Upload image to S3: activity-responses/{user_id}/{activity_id}/{uuid}.{ext}
    2. Run Rekognition structural checks
    3. Run Claude Vision grading
    4. Record ActivityAttempt with response_image_s3_key
    5. Return evaluation result
    """
```

**1e. Create visual grading service** — `backend/app/services/visual_grading.py`

```python
# New file: backend/app/services/visual_grading.py

async def grade_visual_response(
    image_bytes: bytes,
    activity_payload: dict,
    claim_content: str,
) -> dict:
    """Grade a visual student submission.

    1. Rekognition pass: detect_labels + detect_text on the student's image.
       Check against expected_structure (required labels, minimum count).
    2. Claude Vision pass: send image + reference_description + rubric to Bedrock Converse.
       Get 3-outcome grading (understood / did_not_understand / neutral).
    3. Combine: Rekognition provides structural validation, Claude provides holistic assessment.
       If Rekognition detects missing required elements, cap outcome at "neutral" regardless
       of Claude's assessment.

    Returns: {"outcome": str, "feedback": str, "rekognition_labels": list, "structural_check": bool}
    """
```

The Claude Vision grading call:

```python
def _grade_with_vision(image_bytes: bytes, rubric: str, claim_content: str) -> dict:
    client = _get_client()
    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": VISUAL_GRADING_PROMPT}],
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": "jpeg", "source": {"bytes": image_bytes}}},
                {"text": f"Claim: {claim_content}\n\nRubric: {rubric}\n\nGrade this student's visual response."},
            ],
        }],
        inferenceConfig={"maxTokens": 1024, "temperature": 0.1},
    )
```

**1f. Integrate with existing evaluation pipeline** — `backend/app/services/evaluation.py`

In `evaluate_student_response`, add a branch for visual activity types:

```python
VISUAL_TYPES = {"visual_sketch", "visual_label", "visual_proof"}

if activity_type in VISUAL_TYPES and activity_obj is not None:
    # Image grading handled by submit-visual endpoint directly
    # This path handles text-based submissions to visual activities (fallback)
    ...
```

**1g. Add visual types to the chat tool** — `backend/app/services/tool_executor.py`

Update `create_activities_for_claim` tool definition to include the new types:

```python
"enum": ["flashcard", "true_false", "multi_choice", "fill_blank",
         "wrong_on_purpose", "feynman", "visual_sketch", "visual_label", "visual_proof"],
```

#### 2. Frontend / UI Changes

**2a. Visual activity submission component**

Create a new component `VisualActivityCard.tsx` that:
- Displays the `visual_prompt` text
- Shows the reference image if `reference_image_s3_key` is provided
- Has a camera/upload button for the student to submit their image
- Shows an image preview before submitting
- Supports mobile camera capture (`capture="environment"` attribute)
- Calls the `submit-visual` endpoint on submit

**2b. Activity card type routing**

In the existing activity card/player component, route `visual_sketch`, `visual_label`, and `visual_proof` types to the new `VisualActivityCard` component instead of the text input form.

**2c. Result display**

After grading, show:
- The student's submitted image
- The outcome badge (understood/neutral/did_not_understand)
- The feedback text from Claude Vision
- If structural check failed, show which elements were missing

**2d. Activity type icons**

Add icons for the new types in the activity list:
- `visual_sketch` → `Pencil` icon
- `visual_label` → `Tags` icon
- `visual_proof` → `FileSignature` icon

#### 3. Integration Points

- **Existing evaluation pipeline**: Visual grading results feed into the same `ActivityAttempt` → `UserMastery` → XP/streak pipeline. The `evaluate_student_response` function's rating change, XP reward, and streak update all apply identically.
- **Activity queue**: Visual activities appear in the queue alongside text activities. `auto_populate_my_queue` includes them based on the same DAG frontier logic.
- **Teacher broadcast**: Teachers can create visual activities via chat (`create_activities_for_claim` with `types: ["visual_sketch"]`), and they broadcast to all students the same way.
- **Chat tool integration**: The AI tutor can suggest visual activities: "Try drawing the graph structure — I've created a sketch activity for you."

---

### Edge Cases & Failure Modes

- **Blurry or dark images**: Rekognition may return few/no labels. Claude Vision handles degraded images better. If both fail, return `outcome = "neutral"` with feedback: "Your image was hard to read — try taking a clearer photo with better lighting."
- **Wrong type of image**: Student uploads a selfie instead of their work. Rekognition labels will show "Person", "Face" but not "Diagram", "Text", "Graph". Detect this and return feedback: "This doesn't appear to be your work — please upload a photo of your drawing or written solution."
- **Rekognition label mismatch**: The `expected_structure` criteria may be too strict or too lenient. Use confidence thresholds (>70%) for required labels. Make the structural check advisory, not blocking — Claude Vision is the primary grader.
- **Large images**: Apply the same 3.75 MB limit as the Bedrock Converse image size. Resize on the frontend before upload if needed.
- **Mobile camera orientation**: Images from mobile cameras may have EXIF rotation. Use `Pillow` to normalize orientation before sending to Rekognition/Bedrock.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: `generate_visual_activity` produces valid payloads with `visual_prompt`, `expected_structure`, and `reference_description` for each of the three visual types.
- [ ] **Unit test**: `grade_visual_response` returns a 3-outcome result with `rekognition_labels` and `structural_check` fields.
- [ ] **Integration test**: Create a `visual_sketch` activity → submit an image → verify `ActivityAttempt` is created with `response_image_s3_key` populated and a valid outcome.
- [ ] **Integration test**: Submit a clear diagram image → verify `outcome = "understood"` and structural check passes.
- [ ] **Integration test**: Submit a blank image → verify `outcome = "did_not_understand"` with appropriate feedback.
- [ ] **Integration test**: Verify XP, rating change, and streak update work identically for visual activities as for text activities.
- [ ] **Frontend test**: Visual activity card renders the prompt and shows a camera/upload button.
- [ ] **Frontend test**: Image preview displays before submission and can be removed/replaced.
- [ ] **Frontend test**: Mobile: `capture="environment"` attribute opens the camera on mobile devices.
- [ ] **Manual QA**: Create a "draw a binary search tree" activity → draw a BST on paper → photograph → submit → verify meaningful grading feedback.
- [ ] **Manual QA**: Submit a blurry/dark photo → verify graceful "try a clearer photo" feedback instead of a crash.
- [ ] **Manual QA**: Submit a selfie → verify the system detects it's not academic work and prompts re-upload.
