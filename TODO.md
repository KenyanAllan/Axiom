# Axiom — TODO

## Done

- [x] Flashcard Deck activity type (backend gen + grading + API route)
- [x] Quiz activity type with mixed questions (MC, T/F, fill-blank, short-answer)
- [x] Fill in the Blank activity type with deterministic grading
- [x] Quiz submission endpoint with per-question grading
- [x] Frontend renderers: FlashcardDeckActivity, QuizActivity (MC/TF/SA/FB sub-renderers)
- [x] Chat tool-use: 8 Bedrock tools (list_topics, get_topic_claims, create_activities, queue, frontier, mastery)
- [x] Teacher broadcast path — chat-created activities auto-broadcast to classroom
- [x] Adaptive difficulty: `_compute_difficulty` reads UserMastery ratings, maps to difficulty 1-3

## Remaining

- [x] Wire Amazon Polly for TTS (currently uses browser `speechSynthesis`)
- [x] Pass real user ID to `callEvaluate` (currently hardcoded `"usr_student_demo"`)
- [x] Real auth (replace localStorage demo auth)
