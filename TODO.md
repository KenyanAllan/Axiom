# Axiom — TODO

## Activity Redesign

### Flashcard Deck
User picks a deck size: **5, 10, or 15 cards**. Cards pull from multiple topics. Self-graded (flip to reveal answer). Existing `flashcard` type and payload structure (`front`/`back`) works — needs a new "deck" wrapper that batches N cards together.

- [ ] New `flashcard_deck` activity type (or a `deck_size` field on existing flashcard)
- [ ] Deck generation: query claims across multiple topics, build N flashcard payloads
- [ ] Frontend: deck picker UI (5/10/15), card-flip flow with progress counter
- [ ] Grading: self-graded per card, XP awarded for completing the deck

### Quiz
Covers multiple topics, **1–10 questions** per quiz. Mix of question types within a single quiz session:

- [ ] **Multiple Choice** — exists today, needs to be nested under quiz
- [ ] **True / False** — exists today, needs to be nested under quiz
- [ ] **Short Answer** — exists today (LLM-graded via Bedrock), nest under quiz
- [ ] **Fill in the Blank** — NEW type. Mask a key term from the claim content, store `correct_answer` in payload. Deterministic grading (case-insensitive match). ~15 lines backend.

Implementation:
- [ ] New `quiz` activity type with payload: `{ questions: [...], question_count: N }`
- [ ] Each question has its own `type` (multi_choice / true_false / short_answer / fill_blank)
- [ ] Quiz generation: pick N claims across topics, assign question types
- [ ] Frontend: quiz flow UI — question counter, submit per question or all at once
- [ ] Grading: score each question individually, aggregate score for XP

### Fill in the Blank (detail)
- [ ] Generator: take `claim.content`, identify key term (use `claim.title` or regex for bolded/quoted terms), replace with `____`
- [ ] Payload: `{ statement: "The ____ process produces an orthonormal basis.", correct_answer: "Gram-Schmidt" }`
- [ ] Evaluation: add `"fill_blank"` to `DETERMINISTIC_TYPES` in `evaluation.py`, case-insensitive compare
- [ ] Add to `ActivityType` literal in `schemas/activities.py` and frontend `types.ts`

### Keep As-Is
- Wrong on Purpose — standalone activity (AI-generated)
- Scenario — standalone activity (AI-generated)
- Feynman — standalone activity (explain in your own words)
- Audio Overview — standalone activity

## Adaptive Difficulty
- [ ] Read student's `understanding_rating` from `UserMastery` when generating activities
- [ ] Map rating to difficulty: 1-2 → easy, 3 → medium, 4+ → hard
- [ ] Apply in `activity_generator.py` and queue/feed selection

## Other
- [ ] Wire Amazon Polly for TTS (replace browser `speechSynthesis`)
- [ ] Pass real user ID to `callEvaluate` (currently hardcoded `"usr_student_demo"`)
- [ ] Replace length-based grading stubs in frontend activity components
- [ ] Real auth (replace localStorage demo auth)
