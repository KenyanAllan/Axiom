// ── API response types — mirrors backend Pydantic schemas ─────────────────

export type MasteryStatus = "unseen" | "active" | "mastered";
export type DiagnosticType = "wrong_on_purpose" | "feynman" | "micro_project";
export type UserRole = "student" | "teacher" | "individual_learner";
export type Outcome = "understood" | "did_not_understand" | "neutral";

export type ActivityType =
  | "flashcard"
  | "flashcard_deck"
  | "multi_choice"
  | "true_false"
  | "short_answer"
  | "fill_blank"
  | "wrong_on_purpose"
  | "scenario"
  | "feynman"
  | "mini_podcast"
  | "quiz";

export interface UserProfile {
  id: string;
  display_name: string;
  role: UserRole;
  xp: number;
  level: number;
  streak_days?: number;
  email?: string;
  avatar?: string;
  password?: string;
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

// ── Activity attempt / queue types ────────────────────────────────────────────

export interface AttemptCreate {
  activity_id: number;
  claim_id?: string;
  hints_used?: boolean;
  student_response: string;
}

export interface AttemptResult {
  attempt_id: number;
  claim_id: string;
  outcome: Outcome;
  hints_used: boolean;
  xp_awarded: number;
  rating_change: number;
  new_rating: number;
  feedback: string;
  total_xp: number;
  level: number;
  streak_days: number;
}

export interface QueueEntryResponse {
  id: number;
  activity: ActivityResponse;
  is_completed: boolean;
  added_at: string;
  completed_at: string | null;
}

export interface QueueResponse {
  entries: QueueEntryResponse[];
  total: number;
}

export interface ActivityResponse {
  id: number;
  type: ActivityType;
  title: string;
  difficulty: number;
  scope: string;
  target_claim_ids: string[];
  payload: Record<string, any>;
  is_completed: boolean;
  audit_passed: boolean | null;
  created_at: string;
  creator_id: string;
  workspace_id: number | null;
  classroom_id: number | null;
}

// ── Topic / frontier types ────────────────────────────────────────────────────

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

// ── Graph types ───────────────────────────────────────────────────────────────

export interface GraphTopic {
  topic_id: string;
  slug: string | null;
  title: string | null;
  claim_count: number;
  mastered_count: number;
}

export interface GraphEdge {
  from_id: string;
  to_id: string;
}

export interface GraphResponse {
  topics: GraphTopic[];
  edges: GraphEdge[];
}

// ── Mastery / history types ───────────────────────────────────────────────────

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
  outcome: string;
  student_response: string | null;
  feedback: string | null;
  xp_awarded: number;
  timestamp: string;
}

// ── Claim / topic detail types (for wiki wiring) ─────────────────────────────

export interface ClaimResponse {
  id: string;
  topic_id: string;
  source_document_id: number | null;
  title: string;
  content: string;
  diagnostic_prompt: string | null;
  flawed_snippet: string | null;
  rubric: string | null;
}

// ── Source document types ──────────────────────────────────────────────────────

export interface SourceDocument {
  id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  status: "uploaded" | "processing" | "ready" | "error";
  claim_count: number;
  content_type: string;
  transcript_s3_key: string | null;
}

/** Shape returned by the backend GET/POST /api/sources endpoints. */
export interface ApiSourceDocument {
  id: number;
  workspace_id: number;
  uploader_id: string;
  filename: string;
  s3_key: string;
  content_type: string;
  size_bytes: number | null;
  status: string;
  transcript_s3_key: string | null;
  claim_count: number;
  created_at: string;
}

// ── Chat types ────────────────────────────────────────────────────────────────

export interface ChatSessionListItem {
  id: number;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageResponse {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: Record<string, any> | null;
  created_at: string;
}

export interface ChatSessionResponse {
  id: number;
  title: string;
  messages: ChatMessageResponse[];
  created_at: string;
  updated_at: string;
}

// ── Glossary types ───────────────────────────────────────────────────────────

export interface GlossaryTermResponse {
  id: number;
  workspace_id: number;
  source_document_id: number | null;
  term: string;
  definition: string;
  source_ref: {
    chunk_index?: number;
    text_excerpt?: string;
  } | null;
  is_auto_extracted: boolean;
  created_at: string;
}

export interface GlossarySearchResponse {
  query: string;
  results: GlossaryTermResponse[];
  total: number;
}

// ── Workspace types ──────────────────────────────────────────────────────────

export interface WorkspaceResponse {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  is_classroom_shared: boolean;
  classroom_id: number | null;
  created_at: string;
}

// ── View tab types ────────────────────────────────────────────────────────────

export type ViewTab =
  | "activity"
  | "chat"
  | "wiki"
  | "nodemap"
  | "sources"
  | "glossary"
  | "dashboard"
  | "class-chats"
  | "settings";
