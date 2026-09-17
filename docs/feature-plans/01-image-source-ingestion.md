# Image Source Ingestion - Implementation Plan

**Objective:** Allow users to upload images (PNG, JPEG, TIFF, BMP) as source documents. The system OCRs image text via AWS Textract, detects diagrams and visual elements via Amazon Rekognition, and feeds the combined extraction into the existing ingestion pipeline (chunking → topic/claim extraction → embeddings → DAG).

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Upload accept list | `.md, .mdx, .txt, .pdf, .mp3, .mp4, .wav, .ogg, .flac, .webm, .m4a` | Adds `.png, .jpg, .jpeg, .tiff, .bmp, .gif, .heic` |
| Frontend file type hint | "Supports .md, .txt, .pdf, and audio files" | "Supports .md, .txt, .pdf, audio, and image files" |
| Backend content routing | PDF → Textract/PyMuPDF; audio → Transcribe; text → decode | Adds image → Textract `detect_document_text` + Rekognition `detect_labels`/`detect_text` |
| Textract usage | Async `start_document_text_detection` (PDF only, multi-page, S3-only) | Adds sync `detect_document_text` for single-page images (supports inline bytes) |
| Rekognition usage | None | `detect_labels` for diagram/figure classification; `detect_text` for annotation extraction |
| Image preview | Not supported | Presigned S3 URL renders in the source doc viewer panel |

**Technical Prerequisites & Dependencies:**

- **AWS IAM**: EC2 role already has `AmazonTextractFullAccess`. Must add `AmazonRekognitionReadOnlyAccess` to the `EC2InstanceRole` in `cloudformation.yaml`.
- **S3 bucket**: Existing `axiom-source-documents` bucket works — images are stored the same way as PDFs.
- **boto3**: Already in `requirements.txt`. Rekognition client uses the same credential pattern as Textract.
- **No schema migration needed**: `SourceDocument.content_type` is a free-form string; `metadata_` (JSONB) can store Rekognition labels and extraction stats.

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Add Rekognition service module** — `backend/app/services/rekognition.py`

```python
# New file: backend/app/services/rekognition.py
# Functions to create:

def detect_image_text(image_bytes: bytes) -> str:
    """Sync call to Rekognition DetectText.
    Returns concatenated TEXT_DETECTION lines.
    Rekognition DetectText supports PNG/JPEG up to 5 MB inline."""

def detect_image_labels(image_bytes: bytes) -> list[dict]:
    """Sync call to Rekognition DetectLabels.
    Returns top-10 labels with confidence scores.
    Used to classify the image content (diagram, handwriting, photo, etc.)."""
```

Both functions follow the lazy-singleton client pattern from `textract.py` (`_get_textract_client`).

**1b. Add Textract sync image OCR** — `backend/app/services/textract.py`

Add a new function alongside the existing async PDF functions:

```python
def detect_image_text_sync(image_bytes: bytes) -> str:
    """Sync Textract DetectDocumentText for single-page images.
    Uses inline Bytes (not S3) — works for PNG/JPEG/TIFF up to 10 MB.
    Extracts LINE blocks and joins them with newlines."""
```

This uses `detect_document_text(Document={"Bytes": image_bytes})` — the synchronous API, no polling needed. This is different from the existing `start_document_text_detection` which is async and S3-only.

**1c. Add image content-type routing** — `backend/app/services/ingestion.py`

In the `ingest_source_document` function (line ~540), add a new branch between the audio and PDF checks:

```python
IMAGE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/tiff", "image/bmp", "image/gif", "image/heic"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".gif", ".heic"}

def is_image_file(content_type: str, filename: str) -> bool:
    if content_type in IMAGE_CONTENT_TYPES:
        return True
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in IMAGE_EXTENSIONS
```

In `ingest_source_document`, after the `is_audio_file` check and before the PDF check:

```python
elif is_image_file(content_type, filename):
    logger.info("Image file detected — routing through Textract + Rekognition")
    from app.services.textract import detect_image_text_sync
    from app.services.rekognition import detect_image_labels, detect_image_text as rekog_detect_text

    # Primary: Textract OCR (better for paragraphs, tables)
    textract_text = detect_image_text_sync(file_bytes)

    # Secondary: Rekognition DetectText (better for annotations inside diagrams)
    rekog_text = rekog_detect_text(file_bytes)

    # Merge: Textract text is primary; append any Rekognition-only lines
    textract_lines = set(textract_text.strip().splitlines())
    rekog_extra = [l for l in rekog_text.strip().splitlines() if l not in textract_lines]
    full_text = textract_text
    if rekog_extra:
        full_text += "\n\n## Detected Annotations\n" + "\n".join(rekog_extra)

    # Classify image content via Rekognition labels
    labels = detect_image_labels(file_bytes)
    # Store labels in metadata for downstream use
    with Session() as db:
        doc = db.get(SourceDocument, source_doc_id)
        if doc:
            doc.metadata_ = {**(doc.metadata_ or {}), "image_labels": labels}
            db.commit()
```

**1d. Update `parse_source_file` fallback** — `backend/app/services/ingestion.py`

Add image handling to the `parse_source_file` function (line ~168) so it also supports images when called outside the main pipeline:

```python
if content_type in IMAGE_CONTENT_TYPES or any(filename.lower().endswith(ext) for ext in IMAGE_EXTENSIONS):
    from app.services.textract import detect_image_text_sync
    return detect_image_text_sync(file_bytes)
```

#### 2. Frontend / UI Changes

**2a. Update upload accept attribute** — `frontend/src/components/sources/SourceDocsManager.tsx`

Line 831 — change the `accept` attribute:

```tsx
// Before:
accept=".md,.mdx,.txt,.pdf,.mp3,.mp4,.wav,.ogg,.flac,.webm,.m4a"

// After:
accept=".md,.mdx,.txt,.pdf,.mp3,.mp4,.wav,.ogg,.flac,.webm,.m4a,.png,.jpg,.jpeg,.tiff,.bmp,.gif,.heic"
```

**2b. Update help text** — `frontend/src/components/sources/SourceDocsManager.tsx`

Line 826 — update the user-facing description:

```tsx
// Before:
"Supports .md, .txt, .pdf, and audio files. Max 10 MB per file."

// After:
"Supports .md, .txt, .pdf, audio, and image files. Max 10 MB per file."
```

**2c. Add image icon mapping** — `frontend/src/components/sources/SourceDocsManager.tsx`

In the `getDocIcon` function (line ~439), add image detection:

```tsx
import { Image as ImageIcon } from "lucide-react";

function isImageType(ct: string, filename: string): boolean {
  if (ct.startsWith("image/")) return true;
  return /\.(png|jpe?g|tiff?|bmp|gif|heic)$/i.test(filename);
}

// In getDocIcon:
if (isImageType(doc.content_type, doc.filename)) return ImageIcon;
```

**2d. Add image preview in the source doc viewer panel**

In the `SourceDocViewer` component, add an image rendering branch. When `isImageType` is true, render the presigned S3 URL as an `<img>` tag instead of attempting text or PDF rendering:

```tsx
if (isImageType(ct, fname)) {
  return <img src={presignedUrl} alt={fname} className="max-w-full rounded" />;
}
```

#### 3. Integration Points

- **Celery task**: No changes needed — `ingest_source_document_task.delay()` already passes `content_type` and `filename`. The new routing in `ingest_source_document` handles the rest.
- **Downstream pipeline**: After OCR, the text enters `chunk_text()` → `_call_bedrock_extract()` → topic/claim creation — all unchanged.
- **CloudFormation**: Add `AmazonRekognitionReadOnlyAccess` to the `EC2InstanceRole` managed policies.

---

### Edge Cases & Failure Modes

- **Large images (>10 MB Textract sync limit)**: Textract's sync `detect_document_text` accepts up to 10 MB. The existing `upload_max_bytes` is 50 MB. For images over 10 MB, fall back to the async S3-based `start_document_text_detection` path (upload image to S3 first, then use the async API). Add a byte-size check before choosing sync vs. async.
- **Images with no text**: Textract returns empty for photographs or pure diagrams. In this case, Rekognition labels become the primary content. If both OCR sources return empty, set `status = "error"` with metadata `"No text content detected in image"` — same pattern as existing empty-text handling (line ~570).
- **HEIC format**: Textract does not natively support HEIC (Apple's format). Convert to JPEG using `Pillow` before sending to Textract. Add `Pillow` to `requirements.txt`.
- **Rekognition rate limits**: Default is 5 TPS for `DetectLabels`. Wrap calls in the existing `tenacity` retry decorator (`@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))`).
- **Concurrent uploads**: No race condition risk — each upload gets a unique S3 key (`sources/{workspace_id}/{uuid}/{filename}`) and a separate Celery task.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: Upload a PNG with printed text → verify `detect_image_text_sync` returns the expected string.
- [ ] **Unit test**: Upload a PNG with no text → verify the pipeline sets `status = "error"` with appropriate metadata.
- [ ] **Integration test**: Upload a JPEG image via `POST /api/sources/upload` → verify `SourceDocument` is created with `content_type = "image/jpeg"` and status progresses from `"uploaded"` → `"processing"` → `"ready"`.
- [ ] **Integration test**: Upload an image of a textbook page → verify topics and claims are extracted and stored in the database.
- [ ] **Integration test**: Verify Rekognition labels are stored in `SourceDocument.metadata_["image_labels"]`.
- [ ] **Frontend test**: Verify the upload dropzone accepts `.png, .jpg, .jpeg` files.
- [ ] **Frontend test**: Verify image source documents render with the `ImageIcon` icon.
- [ ] **Frontend test**: Verify the source doc viewer displays the image as a preview when clicked.
- [ ] **Manual QA**: Upload a photo of a whiteboard with handwriting → verify extracted text is reasonable.
- [ ] **Manual QA**: Upload a photo of a textbook page with a diagram → verify both text and diagram annotations are captured.
- [ ] **Manual QA**: Upload a blank/dark image → verify graceful error message, not a crash.
