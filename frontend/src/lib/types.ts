// ── API response types — mirrors backend Pydantic schemas ─────────────────

export type MasteryStatus = "unseen" | "active" | "mastered";
export type DiagnosticType = "wrong_on_purpose" | "feynman" | "micro_project";
export type UserRole = "student" | "teacher" | "individual_learner";
export type Outcome = "understood" | "did_not_understand" | "neutral";

export type ActivityType =
  | "flashcard"
  | "multi_choice"
  | "true_false"
  | "short_answer"
  | "wrong_on_purpose"
  | "scenario"
  | "feynman"
  | "audio_overview";

export interface UserProfile {
  id: string;
  display_name: string;
  role: UserRole;
  xp: number;
  level: number;
  streak_days?: number;
}

export interface ClaimCard {
  claim_id: string;
  topic_id: string;
  topic_title: string;
  claim_title: string;
  diagnostic_type: DiagnosticType;
  diagnostic_prompt: string | null;
  flawed_snippet: string | null;
  current_status: MasteryStatus;
}

export interface ActivityFeedResponse {
  cards: ClaimCard[];
  total: number;
}

export interface EvaluateRequest {
  claim_id: string;
  student_response: string;
}

export interface EvaluateResult {
  claim_id: string;
  outcome: Outcome;
  feedback: string;
  xp_awarded: number;
  new_status: MasteryStatus;
  total_xp: number;
  level: number;
  streak_days: number;
  rating_change: number;
  new_rating: number;
}

export interface TopicSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
}

export interface FrontierTopic {
  topic_id: string;
  slug: string;
  title: string;
  claim_count: number;
  mastered_count: number;
}

export interface FrontierResponse {
  frontier: FrontierTopic[];
}

export interface MasteryEntry {
  claim_id: string;
  claim_title: string;
  topic_title: string;
  status: MasteryStatus;
  understanding_rating: number;
  updated_at: string | null;
}

export interface HistoryEvent {
  claim_id: string;
  claim_title: string;
  is_correct: boolean;
  xp_awarded: number;
  timestamp: string;
}

// ── Source document types ──────────────────────────────────────────────────────

export interface SourceDocument {
  id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  status: "processing" | "ready" | "error";
  claim_count: number;
}

// ── View tab types ────────────────────────────────────────────────────────────

export type ViewTab =
  | "activity"
  | "chat"
  | "wiki"
  | "nodemap"
  | "sources"
  | "dashboard";
