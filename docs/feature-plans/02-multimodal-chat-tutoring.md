# Multimodal Chat Tutoring - Implementation Plan

**Objective:** Enable students to share images (photos, screenshots, diagrams) directly in the chat interface. The AI tutor sees the image via Claude's native multimodal vision on Bedrock and responds with full visual understanding — no OCR preprocessing required. This powers the "homework photo → Socratic tutoring" workflow.

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Chat input | Text-only `ChatMessageCreate` with `content: str` | Supports optional image attachment(s) alongside text |
| Message storage | `ChatMessage.content` is `Text` (string only) | New `image_s3_keys` JSONB column for attached image references |
| Bedrock Converse call | `content: [{"text": ...}]` (text-only blocks) | `content: [{"text": ...}, {"image": {"format": "jpeg", "source": {"bytes": ...}}}]` |
| Chat UI | Single text input + send button | Text input + image upload button (click or paste) + image preview strip |
| System prompt | General tutor instructions | Additional instructions for visual analysis and Socratic homework walkthrough |

**Technical Prerequisites & Dependencies:**

- **Bedrock model**: `anthropic.claude-sonnet-4-6` supports multimodal input via the Converse API. Image blocks use `{"image": {"format": "png"|"jpeg"|"gif"|"webp", "source": {"bytes": base64_bytes}}}`. Max image size is 3.75 MB per image, max 20 images per turn.
- **S3**: Images are stored in the existing `axiom-source-documents` bucket under a `chat-images/` prefix for retrieval and history replay.
- **Alembic migration**: Required to add the `image_s3_keys` column to `chat_messages`.
- **No new AWS services**: Claude's native vision on Bedrock handles image understanding — no Textract/Rekognition needed for the chat path.

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Alembic migration — add `image_s3_keys` to `chat_messages`**

```python
# alembic/versions/xxxx_add_chat_image_keys.py
def upgrade():
    op.add_column("chat_messages", sa.Column("image_s3_keys", JSONB, nullable=True))

def downgrade():
    op.drop_column("chat_messages", "image_s3_keys")
```

**1b. Update ORM model** — `backend/app/models/tables.py`

Add to `ChatMessage`:

```python
class ChatMessage(Base):
    ...
    image_s3_keys = Column(JSONB, nullable=True)  # list of S3 keys for attached images
```

**1c. Add chat image upload endpoint** — `backend/app/api/routes/chat.py`

Add a new endpoint that accepts an image file, stores it in S3, and returns the S3 key:

```python
@router.post("/sessions/{session_id}/upload-image")
async def upload_chat_image(
    session_id: int,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload an image for use in a chat message. Returns the S3 key."""
    # Verify session ownership
    # Validate file type (image/png, image/jpeg, image/gif, image/webp only)
    # Validate file size (<= 3.75 MB — Bedrock limit)
    # Upload to S3: chat-images/{session_id}/{uuid}.{ext}
    # Return {"s3_key": ..., "content_type": ...}
```

**1d. Update `ChatMessageCreate` schema** — `backend/app/api/routes/chat.py`

```python
class ChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    image_s3_keys: list[str] | None = None  # S3 keys from upload-image endpoint
```

**1e. Update `send_message` to handle images** — `backend/app/api/routes/chat.py`

In the `send_message` endpoint (line ~372):

```python
# After saving user_msg, store image keys:
user_msg.image_s3_keys = body.image_s3_keys

# When building the Bedrock message, construct multimodal content blocks:
if body.image_s3_keys:
    image_blocks = []
    for s3_key in body.image_s3_keys[:5]:  # Cap at 5 images per message
        image_bytes = await asyncio.to_thread(download_from_s3, s3_key)
        fmt = "jpeg"  # Determine from content_type or extension
        if s3_key.lower().endswith(".png"):
            fmt = "png"
        elif s3_key.lower().endswith(".gif"):
            fmt = "gif"
        elif s3_key.lower().endswith(".webp"):
            fmt = "webp"
        image_blocks.append({
            "image": {
                "format": fmt,
                "source": {"bytes": image_bytes}
            }
        })
```

**1f. Update `_rag_converse_with_tools` to accept image blocks** — `backend/app/api/routes/chat.py`

Modify the function signature and message construction:

```python
async def _rag_converse_with_tools(
    context: str,
    user_message: str,
    db: AsyncSession,
    user_id: str,
    workspace_id: int,
    user_role: str,
    classroom_id: int | None,
    conversation_history: list | None = None,
    image_blocks: list[dict] | None = None,  # NEW
) -> dict[str, Any]:
    ...
    # Build the user message content:
    content_blocks = []
    if image_blocks:
        content_blocks.extend(image_blocks)
    content_blocks.append({"text": prompt})

    messages.append({"role": "user", "content": content_blocks})
```

**1g. Extend the system prompt** — `backend/app/api/routes/chat.py`

Append to `RAG_SYSTEM_PROMPT`:

```
When the student shares an image:
- Describe what you see before diving into analysis
- For homework/problem sets: identify each problem, walk through one at a time using Socratic questioning — ask the student what they think the first step is before showing the solution
- For diagrams: identify components and relationships, ask if the student can explain what the diagram represents
- For handwritten work: read the work carefully, identify where errors occur, and guide the student to find the mistake themselves rather than pointing it out directly
- Never give away the full answer immediately — scaffold understanding through questions
```

**1h. Update `ChatMessageResponse` schema**

```python
class ChatMessageResponse(BaseModel):
    ...
    image_s3_keys: list[str] | None = None
    image_urls: list[str] | None = None  # Presigned S3 URLs for frontend rendering
```

In the response construction, generate presigned URLs for any `image_s3_keys`:

```python
if assistant_msg.image_s3_keys:
    from app.services.s3 import generate_download_url
    resp.image_urls = [generate_download_url(k) for k in assistant_msg.image_s3_keys]
```

#### 2. Frontend / UI Changes

**2a. Add image upload button to chat input** — Update the chat input component

Add a camera/image icon button next to the send button. On click, open a file picker (`accept="image/png,image/jpeg,image/gif,image/webp"`). Also support `Ctrl+V` paste for clipboard images.

**2b. Image preview strip**

When an image is staged for sending, show a thumbnail strip above the text input with an "X" to remove. Store staged images in component state as `{file: File, previewUrl: string, s3Key: string | null}[]`.

**2c. Upload flow**

When a user attaches an image:
1. Show thumbnail preview immediately (via `URL.createObjectURL`)
2. Call `POST /api/chat/sessions/{id}/upload-image` to upload to S3
3. On success, store the returned `s3_key`
4. When user clicks Send, include `image_s3_keys` in the `ChatMessageCreate` payload

**2d. Render images in message history**

In the message bubble component, when a message has `image_urls`, render them as clickable thumbnails above the text content:

```tsx
{msg.image_urls?.map((url, i) => (
  <img key={i} src={url} alt={`Attachment ${i + 1}`} className="max-w-xs rounded-lg mb-2 cursor-pointer" />
))}
```

**2e. Update `api.ts`**

Add the upload function:

```typescript
export async function uploadChatImage(sessionId: number, file: File): Promise<{ s3_key: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/chat/sessions/${sessionId}/upload-image`, {
    method: "POST",
    headers: authHeaders(), // no Content-Type — let browser set multipart boundary
    body: formData,
  });
  return res.json();
}
```

Update `sendChatMessage` to accept optional `image_s3_keys`:

```typescript
export async function sendChatMessage(
  sessionId: number,
  content: string,
  image_s3_keys?: string[]
): Promise<ChatMessage> { ... }
```

#### 3. Integration Points

- **Conversation history replay**: When loading prior messages that contain images, the backend generates presigned URLs via `generate_download_url`. The frontend renders them inline. Old text-only messages are unaffected.
- **RAG context**: The RAG retrieval (embedding-based claim search) still runs on the text portion of the message. Image understanding is handled entirely by Claude Vision — no vector search on images.
- **Tool use**: All 10 existing chat tools work alongside multimodal messages. Claude can see the image AND call tools (e.g., student shares homework photo, Claude reads it, then calls `create_activities_for_claim` to generate practice on the weak topic).
- **Rate limiting**: The existing `20/minute` rate limit on `send_message` applies equally to multimodal messages. Consider a lower limit for image messages if Bedrock costs are a concern.

---

### Edge Cases & Failure Modes

- **Bedrock image size limit**: Max 3.75 MB per image. The upload endpoint validates this and returns 413 if exceeded. Frontend shows "Image too large — please resize or compress."
- **Unsupported format**: Bedrock Converse supports PNG, JPEG, GIF, WebP. Reject TIFF, BMP, HEIC at the upload endpoint. Return 415 with a clear error message.
- **S3 upload failure**: If the image upload to S3 fails, the frontend disables the send button and shows an error toast. The user can retry or remove the image.
- **Image-only messages (no text)**: Validate that either `content` has meaningful text OR `image_s3_keys` is non-empty. If the user sends only an image, set a default text like "Please look at this image" to satisfy the `min_length=1` constraint, or relax the constraint.
- **Presigned URL expiry**: URLs expire after `s3_presigned_url_expiry` (default 3600s). If a user scrolls to old messages, images may 404. The frontend should detect 403/404 on image load and re-fetch the URL via the existing `view-url` pattern.
- **Cost control**: Multimodal Bedrock calls cost more than text-only. Log image message counts in the existing timing log (`_bedrock_elapsed`) for monitoring.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: `upload_chat_image` rejects files > 3.75 MB with 413.
- [ ] **Unit test**: `upload_chat_image` rejects non-image content types with 415.
- [ ] **Unit test**: `ChatMessageCreate` with `image_s3_keys` serializes and validates correctly.
- [ ] **Integration test**: Upload image → send message with `image_s3_keys` → verify Bedrock receives multimodal content blocks → verify assistant response references image content.
- [ ] **Integration test**: Load a chat session with image messages → verify `image_urls` are populated with valid presigned S3 URLs.
- [ ] **Integration test**: Send a message with both text and image → verify RAG retrieval still runs on the text portion.
- [ ] **Frontend test**: Paste an image from clipboard → verify it appears in the preview strip.
- [ ] **Frontend test**: Click the image upload button → select a PNG → verify thumbnail preview appears.
- [ ] **Frontend test**: Send a message with an image → verify the image renders in the message history.
- [ ] **Manual QA**: Take a photo of handwritten math homework → send in chat → verify the tutor reads the problems and begins Socratic questioning (asking what the student thinks, not revealing the answer).
- [ ] **Manual QA**: Send a screenshot of a code snippet → verify the tutor can read and discuss the code.
- [ ] **Manual QA**: Send a diagram/flowchart → verify the tutor describes the structure and asks the student to explain it.
