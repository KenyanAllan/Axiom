# Multilingual Platform - Implementation Plan

**Objective:** Enable the entire Axiom platform to operate across languages using Amazon Translate. Source documents can be ingested in any language and the Socratic tutor converses in the student's preferred language, while preserving domain-specific technical terms (e.g., "Directed Acyclic Graph", "topological sort") via Custom Terminology.

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| User language preference | None — English assumed everywhere | `preferred_language` column on `User` (ISO 639-1 code, e.g., `"es"`, `"ja"`) |
| Source ingestion | English text → English topics/claims | Any-language text → optionally translated to English for embeddings, original stored alongside |
| Chat tutor responses | English only | Responds in user's `preferred_language` via Amazon Translate post-processing |
| Technical terms | N/A | Custom Terminology CSV preserves domain terms across translations |
| Activity content | English only | Generated in English, translated to user's language on delivery |
| UI chrome | English only | Out of scope (focus is on AI-generated content, not React i18n) |

**Technical Prerequisites & Dependencies:**

- **AWS IAM**: Add `TranslateReadOnly` (or `translate:TranslateText`, `translate:GetTerminology`, `translate:ImportTerminology`) to the `EC2InstanceRole` in `cloudformation.yaml`.
- **Amazon Translate Custom Terminology**: Create and register a CSV file mapping domain terms that must not be translated. This is a one-time setup via `import_terminology` API call.
- **Alembic migration**: Add `preferred_language` to `users` table, add `original_language` and `translated_content` to `atomic_claims`.
- **boto3**: Already in `requirements.txt`. Translate uses the same credential pattern.
- **Settings**: Add `translate_terminology_name` to `config.py`.

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Alembic migration — language support columns**

```python
def upgrade():
    op.add_column("users", sa.Column("preferred_language", sa.String(), nullable=True, server_default="en"))
    op.add_column("atomic_claims", sa.Column("original_language", sa.String(), nullable=True))
    op.add_column("atomic_claims", sa.Column("original_content", sa.Text(), nullable=True))
    op.add_column("glossary_terms", sa.Column("original_language", sa.String(), nullable=True))
    op.add_column("glossary_terms", sa.Column("original_definition", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("users", "preferred_language")
    op.drop_column("atomic_claims", "original_language")
    op.drop_column("atomic_claims", "original_content")
    op.drop_column("glossary_terms", "original_language")
    op.drop_column("glossary_terms", "original_definition")
```

**1b. Update ORM models** — `backend/app/models/tables.py`

```python
class User(Base):
    ...
    preferred_language = Column(String, nullable=True, default="en")

class AtomicClaim(Base):
    ...
    original_language = Column(String, nullable=True)
    original_content = Column(Text, nullable=True)

class GlossaryTerm(Base):
    ...
    original_language = Column(String, nullable=True)
    original_definition = Column(Text, nullable=True)
```

**1c. Create Amazon Translate service** — `backend/app/services/translate.py`

```python
# New file: backend/app/services/translate.py

def _get_translate_client():
    """Lazy singleton following existing pattern from textract.py."""

def detect_language(text: str) -> str:
    """Use Translate's auto-detection (or Comprehend DetectDominantLanguage).
    Returns ISO 639-1 code. Falls back to 'en' on error."""

def translate_text(
    text: str,
    source_lang: str,
    target_lang: str,
    terminology_names: list[str] | None = None,
) -> str:
    """Call translate_text with optional Custom Terminology.
    Returns translated string. No-ops if source == target."""

def register_custom_terminology(csv_path: str, name: str) -> None:
    """One-time call: imports a Custom Terminology CSV.
    CSV format: en,es,ja,... columns with term rows."""
```

**1d. Create Custom Terminology CSV** — `backend/data/axiom_terminology.csv`

```csv
en,es,fr,ja,zh,de
Directed Acyclic Graph,Directed Acyclic Graph,Directed Acyclic Graph,Directed Acyclic Graph,Directed Acyclic Graph,Directed Acyclic Graph
topological sort,topological sort,topological sort,topological sort,topological sort,topological sort
Feynman technique,Feynman technique,Feynman technique,Feynman technique,Feynman technique,Feynman technique
```

Register via a management script or startup hook: `register_custom_terminology("backend/data/axiom_terminology.csv", "axiom-stem-terms")`.

**1e. Update config** — `backend/app/core/config.py`

```python
# Amazon Translate
translate_terminology_name: str = "axiom-stem-terms"
```

**1f. Integrate translation into the ingestion pipeline** — `backend/app/services/ingestion.py`

After extracting `full_text` (line ~569) and before `chunk_text`:

```python
from app.services.translate import detect_language, translate_text

source_language = detect_language(full_text[:1000])  # Sample first 1000 chars
if source_language != "en":
    logger.info("Non-English source detected (%s) — translating to English for embedding", source_language)
    full_text_english = translate_text(full_text, source_language, "en", [settings.translate_terminology_name])
else:
    full_text_english = full_text
    source_language = "en"

# Chunk and extract from English version (for consistent embeddings)
chunks = chunk_text(full_text_english)
```

When storing claims, save the original language content:

```python
claim = AtomicClaim(
    ...
    content=claim_content,  # English version for embeddings/RAG
    original_language=source_language if source_language != "en" else None,
    original_content=original_chunk_claim_content if source_language != "en" else None,
)
```

**1g. Translate chat responses** — `backend/app/api/routes/chat.py`

After getting the final response from `_rag_converse_with_tools`:

```python
# Load user's preferred language
user = await db.get(User, user_id)
user_lang = user.preferred_language or "en"

if user_lang != "en":
    from app.services.translate import translate_text
    rag_result["content"] = await asyncio.to_thread(
        translate_text,
        rag_result["content"],
        "en",
        user_lang,
        [settings.translate_terminology_name],
    )
```

**1h. Add language preference endpoint** — `backend/app/api/routes/users.py`

Ensure the existing `updateUserProfile` endpoint (or equivalent) accepts `preferred_language`:

```python
class UserProfileUpdate(BaseModel):
    display_name: str | None = None
    avatar: str | None = None
    preferred_language: str | None = None  # ISO 639-1 code
```

#### 2. Frontend / UI Changes

**2a. Language selector in Settings page**

Add a language dropdown to the existing `SettingsPage.tsx`. Options: English, Spanish, French, German, Japanese, Chinese, Portuguese, Korean, Arabic, Hindi (expandable). Calls the profile update endpoint with `preferred_language`.

**2b. Display language indicator in chat**

Show a small language badge in the chat header (e.g., "Tutoring in: Español") so the user knows translation is active.

**2c. Source document language badge**

In the source doc list, show a small flag/badge if the document was ingested in a non-English language. Use the `original_language` from claim metadata or a new field on `SourceDocument.metadata_`.

#### 3. Integration Points

- **Embeddings**: All embeddings are generated from English text (translated if needed). This ensures consistent vector similarity regardless of source language.
- **RAG retrieval**: Claims are stored in English. When the user asks a question in Spanish, the question is embedded as-is — Titan Embeddings v2 handles multilingual input reasonably well. If retrieval quality drops, add a pre-translation step for the user query.
- **Activity generation**: Activities are generated from English claims via Bedrock. For non-English users, translate the activity payload (`title`, `content`, `options`, etc.) via Translate before delivery. Apply this in `activity_generator.py` or at the API response layer.
- **Glossary**: Glossary terms extracted in English are translated to the user's language on lookup. The `search_glossary` tool result gets post-processed.

---

### Edge Cases & Failure Modes

- **Translation API failure**: Wrap all `translate_text` calls in try/except. On failure, return the English text with a note: "(Translation unavailable — showing English)". Never block the core pipeline on translation failure.
- **Custom Terminology misses**: New domain terms added during ingestion won't be in the terminology CSV. Build a management endpoint or script to update the CSV and re-register. Monitor translation quality for term drift.
- **Mixed-language source documents**: A document might contain English and another language. The `detect_language` call samples the first 1000 chars — if it detects English, skip translation. For truly mixed documents, the quality may degrade; this is an accepted limitation.
- **Right-to-left languages (Arabic, Hebrew)**: Frontend must handle RTL text rendering. Add `dir="auto"` to chat message containers and activity display areas.
- **Amazon Translate cost**: $15 per million characters. Log translated character counts for cost monitoring. Cache translated activity payloads to avoid re-translating on every view.
- **Language mismatch in chat**: If a user writes in English but has `preferred_language = "es"`, the response is still translated to Spanish. The user can switch their preference at any time. Consider auto-detecting the message language and responding in the same language instead of blindly using the preference.

---

### Acceptance Criteria & Verification

- [ ] **Unit test**: `detect_language("Hola mundo")` returns `"es"`.
- [ ] **Unit test**: `translate_text("Hello", "en", "es")` returns a Spanish string.
- [ ] **Unit test**: Custom Terminology preserves "topological sort" untranslated in Spanish output.
- [ ] **Integration test**: Upload a Spanish-language PDF → verify claims are stored in English with `original_language = "es"` and `original_content` in Spanish.
- [ ] **Integration test**: Set `preferred_language = "es"` → send a chat message → verify the assistant response is in Spanish.
- [ ] **Integration test**: Set `preferred_language = "en"` → send a chat message → verify no translation call is made (passthrough).
- [ ] **Frontend test**: Language selector in Settings → select "Español" → verify profile update API call includes `preferred_language: "es"`.
- [ ] **Frontend test**: Chat header shows "Tutoring in: Español" when language is set to Spanish.
- [ ] **Manual QA**: Upload a Japanese textbook PDF → verify topics/claims are created → chat about the content in Japanese → verify coherent Socratic tutoring in Japanese with technical terms preserved in English.
- [ ] **Manual QA**: Verify translation fallback: disable Translate permissions temporarily → verify English responses are returned with a note, not a crash.
