# Multilingual Homework Tutoring - Implementation Plan

**Objective:** Enable international students to photograph homework written in any language, send it in chat, and receive Socratic tutoring in their preferred language — with technical terms preserved correctly. This is the compound feature that combines Multimodal Chat (Feature 02), Multilingual Platform (Feature 03), and Persistent Tutor Memory (Feature 06) into a cohesive end-to-end workflow.

**Current State vs. Desired State:**

| Aspect | Current State | Desired State |
|--------|--------------|---------------|
| Homework input | Text-only, English-only chat messages | Image of homework (any language) + optional text in any language |
| Language handling | English assumed | Auto-detect homework language; respond in student's `preferred_language`; preserve technical terms via Custom Terminology |
| Tutor context | Static RAG with no student personalization | Personalized: tutor knows the student's misconceptions, their language, and their homework's visual content |
| Cross-session learning | None | Tutor remembers homework struggles from prior sessions and connects them to current work |
| Workflow | Student types a question → text response | Student photographs homework → tutor reads it → Socratic walkthrough → generates follow-up activities → tracks misconceptions |

**Technical Prerequisites & Dependencies:**

This is a **composition feature** — it requires the following features to be implemented first:

1. **Feature 02 (Multimodal Chat Tutoring)**: Image upload in chat, multimodal Bedrock Converse, `image_s3_keys` on `ChatMessage`.
2. **Feature 03 (Multilingual Platform)**: Amazon Translate service, `preferred_language` on `User`, Custom Terminology, response translation.
3. **Feature 06 (Persistent Tutor Memory)**: DynamoDB student memory, misconception tracking, personalized system prompt.

Additionally:
- **Amazon Translate**: Already configured by Feature 03.
- **Bedrock Claude Vision**: Already configured by Feature 02.
- **DynamoDB**: Already configured by Feature 06.

No new AWS services, migrations, or pip dependencies beyond what the prerequisite features provide.

---

### Step-by-Step Execution Plan

#### 1. Data Model / Backend Changes

**1a. Enhanced system prompt for multilingual visual tutoring** — `backend/app/api/routes/chat.py`

Create a specialized prompt section that activates when an image is attached AND the student's language is not English:

```python
MULTILINGUAL_VISUAL_TUTOR_PROMPT = """\
## MULTILINGUAL HOMEWORK TUTORING MODE

The student has shared an image of their homework. Their preferred language is {language_name}.

Instructions:
1. IDENTIFY the language of the homework in the image. If it differs from the student's preferred language, note this.
2. READ the entire homework carefully — every problem, every handwritten annotation, every crossed-out attempt.
3. RESPOND in {language_name}. Use Amazon Translate Custom Terminology rules: keep technical terms in their original form (e.g., "topological sort", "eigenvalue", "polymorphism") even when responding in {language_name}.
4. SOCRATIC METHOD: For each problem, do NOT give the answer. Instead:
   a. Ask the student what they think the first step is
   b. If they show work that's partially correct, acknowledge what's right before addressing errors
   c. If they show work with an error, ask a guiding question that helps them discover the mistake themselves
   d. Only reveal the next step after the student has attempted it
5. CONNECT to prior knowledge: Reference the student's known misconceptions and strengths from their profile.
6. After the tutoring session, offer to create practice activities targeting any weak areas identified.

Remember: the goal is understanding, not answers. A student who discovers their own mistake learns more than one who is told the answer.
"""
```

**1b. Compose the multilingual visual chat flow** — `backend/app/api/routes/chat.py`

In `send_message`, when the message has images and the user's language is not English, assemble the full personalized prompt:

```python
# After loading user, conversation history, and RAG context:
user_lang = user.preferred_language or "en"
has_images = bool(body.image_s3_keys)

# Build composite system prompt
system_prompt = RAG_SYSTEM_PROMPT

# Layer 1: Student profile from persistent memory (Feature 06)
from app.services.student_memory import get_student_context_summary
student_context = await get_student_context_summary(user_id)
if student_context:
    system_prompt += f"\n\n## STUDENT PROFILE\n{student_context}"

# Layer 2: Multilingual visual tutoring mode (when applicable)
if has_images and user_lang != "en":
    language_names = {"es": "Spanish", "fr": "French", "ja": "Japanese", "zh": "Chinese", ...}
    lang_name = language_names.get(user_lang, user_lang)
    system_prompt += "\n\n" + MULTILINGUAL_VISUAL_TUTOR_PROMPT.format(language_name=lang_name)
elif has_images:
    # English visual tutoring (from Feature 02's system prompt addition)
    system_prompt += "\n\n" + VISUAL_TUTOR_PROMPT
elif user_lang != "en":
    system_prompt += f"\n\nRespond in {language_names.get(user_lang, user_lang)}. Preserve technical terms in English."
```

**1c. Post-response translation with visual context** — `backend/app/api/routes/chat.py`

After getting the Bedrock response, apply translation only if needed:

```python
if user_lang != "en" and not has_images:
    # Non-visual messages: translate the response (Feature 03 behavior)
    from app.services.translate import translate_text
    rag_result["content"] = await asyncio.to_thread(
        translate_text, rag_result["content"], "en", user_lang,
        [settings.translate_terminology_name],
    )
# When images are present, Claude already responds in the target language
# (instructed by MULTILINGUAL_VISUAL_TUTOR_PROMPT), so skip translation
# to avoid double-translating. But validate: if Claude responded in English
# despite instructions, translate as fallback.
elif user_lang != "en" and has_images:
    from app.services.translate import detect_language
    response_lang = await asyncio.to_thread(detect_language, rag_result["content"][:500])
    if response_lang == "en":
        from app.services.translate import translate_text
        rag_result["content"] = await asyncio.to_thread(
            translate_text, rag_result["content"], "en", user_lang,
            [settings.translate_terminology_name],
        )
```

**1d. Homework-triggered activity generation** — `backend/app/services/tool_executor.py`

After the tutoring conversation about homework, the tutor should offer to create targeted activities. This is already possible via existing tools (`create_activities_for_claim`), but add a convenience prompt in the system instructions:

```python
# In the MULTILINGUAL_VISUAL_TUTOR_PROMPT:
"6. After the tutoring session, offer to create practice activities targeting any weak areas identified.
    Use create_activities_for_claim with the relevant claim_id and suggest types based on the error pattern:
    - Conceptual confusion → feynman + wrong_on_purpose
    - Procedural errors → fill_blank + multi_choice
    - Structural mistakes → visual_sketch (if Feature 04 is available)"
```

**1e. Misconception tagging from homework sessions** — `backend/app/services/student_memory.py`

Add a function that extracts misconceptions from homework tutoring sessions:

```python
async def extract_misconceptions_from_chat(
    student_id: str,
    session_id: int,
    db: AsyncSession,
) -> None:
    """Called at the end of a homework tutoring chat session.
    Reads the conversation, identifies recurring errors discussed,
    and creates/updates misconception entries in DynamoDB.

    Uses Bedrock to analyze the conversation:
    - What topics were covered?
    - What errors did the student make?
    - Were the errors resolved during the session?
    """
```

Trigger this when a chat session has 5+ messages and includes image attachments — it's likely a homework tutoring session.

**1f. Add a chat tool for homework-specific actions** — `backend/app/services/tool_executor.py`

```python
{
    "name": "analyze_homework_image",
    "description": (
        "Analyze an image the student has shared in detail. "
        "Returns structured information about what's in the image: "
        "detected text (in any language), mathematical notation, "
        "diagram structures, and any errors visible in the student's work. "
        "Use this when you need a detailed breakdown of a homework image "
        "before beginning Socratic tutoring."
    ),
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "image_index": {
                    "type": "integer",
                    "description": "Index of the image in the current message (0-based). Default 0.",
                },
            },
            "required": [],
        }
    },
}
```

The tool executor runs Textract OCR + Rekognition on the specified image and returns structured text, enabling the tutor to reference specific parts of the homework.

#### 2. Frontend / UI Changes

**2a. Homework mode indicator**

When a student attaches an image AND their language is non-English, show a banner in the chat: "Homework tutoring mode — tutoring in {language}" with a flag icon.

**2b. Language-aware image upload prompt**

When the student clicks the image upload button, show contextual help in their language:
- EN: "Upload a photo of your homework"
- ES: "Sube una foto de tu tarea"
- JA: "宿題の写真をアップロード"

Use a static translations map for the 10 supported languages (this is a small set of UI strings, not full i18n).

**2c. Homework session summary**

At the end of a homework tutoring session (when the student navigates away or closes the chat), show a summary:
- Topics covered
- Errors identified and whether they were resolved
- Suggested follow-up activities (linked to the activity queue)
- "Your tutor will remember these areas for next time" note

**2d. RTL text support**

For Arabic, Hebrew, and other RTL languages, ensure chat messages render correctly:
```tsx
<div dir="auto" className="chat-message">
  {message.content}
</div>
```

#### 3. Integration Points

- **Feature 02 (Multimodal Chat)**: This feature builds directly on top of the image upload and multimodal Converse infrastructure. The image upload, S3 storage, and Bedrock multimodal message construction are all reused.
- **Feature 03 (Multilingual Platform)**: Translation, language detection, and Custom Terminology are reused. The key addition is that Claude is instructed to respond in the target language directly (for visual messages) rather than responding in English and translating after.
- **Feature 06 (Persistent Tutor Memory)**: Misconceptions identified during homework tutoring flow into DynamoDB. The personalized system prompt includes these misconceptions in subsequent sessions.
- **Feature 04 (Visual Activity Types)**: After identifying weak areas in homework, the tutor can generate `visual_sketch` or `visual_proof` activities targeting the same concepts.
- **Existing tools**: All 10 chat tools work in multilingual mode. Tool outputs (activity creation confirmations, glossary lookups, etc.) are translated via Translate before being included in the response.

---

### Edge Cases & Failure Modes

- **Mixed-language homework**: A homework sheet might contain problems in Japanese with mathematical notation in standard (Latin) form. Claude Vision handles this well — mathematical notation is language-agnostic. Translate's Custom Terminology ensures math terms aren't mangled.
- **Claude responds in wrong language**: Despite instructions, Claude might default to English for complex technical explanations. The fallback translation check (1c) handles this by detecting the response language and translating if needed.
- **Multiple homework pages**: Students might need to share multiple images for a multi-page assignment. The system supports up to 5 images per message (Bedrock limit of 20, capped at 5 for cost control). For longer assignments, suggest splitting into multiple messages, one page at a time.
- **Handwriting recognition across languages**: Claude Vision is strong at reading handwriting in Latin, CJK, and Arabic scripts. Cyrillic and Indic scripts may have lower accuracy. For these, offer a fallback: "I'm having trouble reading your handwriting — could you type out the problem?"
- **Translation delays**: Amazon Translate adds ~100-200ms per call. For the chat path, this is acceptable. If the response is very long (>5000 chars), split into chunks for translation to avoid hitting Translate's 10KB limit per call.
- **Custom Terminology gaps**: New technical terms from homework content may not be in the CSV. The tutor should detect when Translate mangles a term and fall back to keeping it in the source language. Monitor for these and update the terminology file.
- **Student privacy**: Homework images may contain the student's name, school, or other PII. S3 images are scoped to the student's session and only accessible via presigned URLs. Teachers in the same classroom can view work via the teacher dashboard. Images are not used for training or shared outside the workspace.

---

### Acceptance Criteria & Verification

- [ ] **Integration test**: Student with `preferred_language = "ja"` uploads homework image → verify system prompt includes `MULTILINGUAL_VISUAL_TUTOR_PROMPT` with `language_name = "Japanese"`.
- [ ] **Integration test**: Student with `preferred_language = "en"` uploads homework image → verify standard (English) visual tutor prompt is used, NOT the multilingual one.
- [ ] **Integration test**: Non-English homework tutoring response → verify technical terms are preserved in English (e.g., "topological sort" appears untranslated in a Spanish response).
- [ ] **Integration test**: Claude responds in English despite multilingual instructions → verify fallback translation kicks in and response is delivered in the student's language.
- [ ] **Integration test**: Homework session with 5+ messages → verify `extract_misconceptions_from_chat` is triggered and DynamoDB is updated.
- [ ] **Integration test**: Student returns in a new session → verify the tutor references homework misconceptions from the prior session.
- [ ] **Frontend test**: Homework mode banner appears when image + non-English language detected.
- [ ] **Frontend test**: Image upload prompt appears in the student's preferred language.
- [ ] **Frontend test**: RTL text renders correctly for Arabic/Hebrew.
- [ ] **Manual QA**: Photograph Japanese math homework → send in chat → verify tutor responds in Japanese, reads all problems, and uses Socratic method (asks before telling).
- [ ] **Manual QA**: Photograph Spanish essay homework → send in chat → verify tutor responds in Spanish and provides writing feedback.
- [ ] **Manual QA**: Complete a homework tutoring session → navigate away → return next day → ask about the same topic → verify the tutor references yesterday's homework.
- [ ] **Manual QA**: Send homework image with technical terms (e.g., "eigenvalue") → verify the term appears in the response untranslated, in the original English form.
