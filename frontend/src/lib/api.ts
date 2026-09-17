import type {
  ActivityFeedResponse,
  ApiSourceDocument,
  AttemptCreate,
  AttemptResult,
  ChatMessageResponse,
  ChatSessionListItem,
  ChatSessionResponse,
  ClaimResponse,
  EvaluateRequest,
  EvaluateResult,
  Figure,
  FigureViewUrlResponse,
  FrontierResponse,
  GlossarySearchResponse,
  GlossaryTermResponse,
  GraphResponse,
  HistoryEvent,
  MasteryEntry,
  QueueResponse,
  SourceDocument,
  TopicSummary,
  UserProfile,
  WorkbenchResponse,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEMO_WORKSPACE_ID = 1;
export const TOKEN_KEY = "axiom_token";
export const WORKSPACE_KEY = "axiom_workspace_id";

export function getWorkspaceId(): number {
  if (typeof window === "undefined") return DEMO_WORKSPACE_ID;
  const stored = localStorage.getItem(WORKSPACE_KEY);
  return stored ? parseInt(stored, 10) : DEMO_WORKSPACE_ID;
}

export function authOnly(userId: string): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return { "X-Demo-User": userId };
}

function headers(userId: string): HeadersInit {
  return { "Content-Type": "application/json", ...authOnly(userId) };
}

function handle401(res: Response): void {
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: UserProfile;
}

export async function authLogin(
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    handle401(res);
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Login failed: ${res.status}`);
  }
  return res.json();
}

export async function authRegister(
  email: string,
  password: string,
  displayName: string,
  role: "student" | "teacher"
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName, role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Registration failed: ${res.status}`);
  }
  return res.json();
}

// ── Audio / Polly TTS ────────────────────────────────────────────────────────

export interface SynthesizeResponse {
  audio_url: string;
  s3_key: string;
  duration_seconds: number | null;
  text_length: number;
}

export async function synthesizeSpeech(
  userId: string,
  text: string
): Promise<SynthesizeResponse> {
  const res = await fetch(`${BASE}/api/audio/synthesize`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Synthesize failed: ${res.status}`); }
  return res.json();
}

// ── User profile ─────────────────────────────────────────────────────────────

export async function updateUserProfile(
  userId: string,
  patch: { email?: string | null; avatar?: string | null; preferred_language?: string | null }
): Promise<UserProfile> {
  const res = await fetch(`${BASE}/api/users/me`, {
    method: "PATCH",
    headers: headers(userId),
    body: JSON.stringify(patch),
  });
  if (!res.ok) { handle401(res); throw new Error(`Profile update failed: ${res.status}`); }
  return res.json();
}

// ── Activity feed / evaluate ──────────────────────────────────────────────────

export async function fetchActivityFeed(
  userId: string,
  workspaceId: number = getWorkspaceId(),
  limit = 20,
  offset = 0
): Promise<ActivityFeedResponse> {
  const res = await fetch(
    `${BASE}/api/activities/feed?workspace_id=${workspaceId}&limit=${limit}&offset=${offset}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Feed fetch failed: ${res.status}`); }
  return res.json();
}

export async function evaluateResponse(
  userId: string,
  body: EvaluateRequest
): Promise<EvaluateResult> {
  const res = await fetch(`${BASE}/api/activities/evaluate`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  if (!res.ok) { handle401(res); throw new Error(`Evaluate failed: ${res.status}`); }
  return res.json();
}

export async function submitAttempt(
  userId: string,
  body: AttemptCreate
): Promise<AttemptResult> {
  const res = await fetch(`${BASE}/api/activities/attempt`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  if (!res.ok) { handle401(res); throw new Error(`Attempt failed: ${res.status}`); }
  return res.json();
}

export async function fetchActivityQueue(
  userId: string,
  workspaceId: number = getWorkspaceId(),
  limit = 20,
  offset = 0
): Promise<QueueResponse> {
  const res = await fetch(
    `${BASE}/api/activities/queue?workspace_id=${workspaceId}&limit=${limit}&offset=${offset}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Queue fetch failed: ${res.status}`); }
  return res.json();
}

// ── Frontier ──────────────────────────────────────────────────────────────────

export async function fetchFrontier(
  userId: string
): Promise<FrontierResponse> {
  const res = await fetch(`${BASE}/api/frontier`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Frontier fetch failed: ${res.status}`); }
  return res.json();
}

// ── User profile / mastery / history ──────────────────────────────────────────

export async function fetchUserProfile(
  userId: string
): Promise<UserProfile> {
  const res = await fetch(`${BASE}/api/users/me`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`User profile fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchUserMastery(
  userId: string
): Promise<MasteryEntry[]> {
  const res = await fetch(`${BASE}/api/users/me/mastery`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Mastery fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchUserHistory(
  userId: string
): Promise<HistoryEvent[]> {
  const res = await fetch(`${BASE}/api/users/me/history`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`History fetch failed: ${res.status}`); }
  return res.json();
}

// ── Topics / claims (wiki wiring) ─────────────────────────────────────────────

export async function fetchTopics(
  userId: string,
  workspaceId = getWorkspaceId()
): Promise<TopicSummary[]> {
  const res = await fetch(
    `${BASE}/api/topics?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Topics fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchClaims(
  userId: string,
  workspaceId = getWorkspaceId()
): Promise<ClaimResponse[]> {
  const res = await fetch(
    `${BASE}/api/claims?workspace_id=${workspaceId}&limit=200`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Claims fetch failed: ${res.status}`); }
  return res.json();
}

export async function createTopic(
  userId: string,
  title: string,
  summary?: string,
  workspaceId: number = getWorkspaceId()
): Promise<TopicSummary> {
  const res = await fetch(`${BASE}/api/topics`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ workspace_id: workspaceId, title, summary: summary || null }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Create topic failed: ${res.status}`); }
  return res.json();
}

export async function updateTopic(
  userId: string,
  topicId: string,
  data: { title?: string; summary?: string }
): Promise<TopicSummary> {
  const res = await fetch(`${BASE}/api/topics/${topicId}`, {
    method: "PUT",
    headers: headers(userId),
    body: JSON.stringify(data),
  });
  if (!res.ok) { handle401(res); throw new Error(`Update topic failed: ${res.status}`); }
  return res.json();
}

export async function deleteTopic(
  userId: string,
  topicId: string
): Promise<void> {
  const res = await fetch(`${BASE}/api/topics/${topicId}`, {
    method: "DELETE",
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Delete topic failed: ${res.status}`); }
}

export async function createClaim(
  userId: string,
  topicId: string,
  title: string,
  content: string,
  rubric?: string
): Promise<ClaimResponse> {
  const res = await fetch(`${BASE}/api/claims`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ topic_id: topicId, title, content, rubric: rubric || null }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Create claim failed: ${res.status}`); }
  return res.json();
}

export async function updateClaim(
  userId: string,
  claimId: string,
  data: { title?: string; content?: string; rubric?: string }
): Promise<ClaimResponse> {
  const res = await fetch(`${BASE}/api/claims/${claimId}`, {
    method: "PUT",
    headers: headers(userId),
    body: JSON.stringify(data),
  });
  if (!res.ok) { handle401(res); throw new Error(`Update claim failed: ${res.status}`); }
  return res.json();
}

export async function deleteClaim(
  userId: string,
  claimId: string
): Promise<void> {
  const res = await fetch(`${BASE}/api/claims/${claimId}`, {
    method: "DELETE",
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Delete claim failed: ${res.status}`); }
}

// ── Graph (node map) ──────────────────────────────────────────────────────────

export async function fetchGraph(
  userId: string,
  workspaceId: number = getWorkspaceId()
): Promise<GraphResponse> {
  const res = await fetch(`${BASE}/api/dag/graph?workspace_id=${workspaceId}`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Graph fetch failed: ${res.status}`); }
  return res.json();
}

// ── Source documents ──────────────────────────────────────────────────────────

function mapApiSource(src: ApiSourceDocument): SourceDocument {
  return {
    id: String(src.id),
    filename: src.filename,
    size_bytes: src.size_bytes ?? 0,
    uploaded_at: src.created_at,
    status: src.status as SourceDocument["status"],
    claim_count: src.claim_count ?? 0,
    content_type: src.content_type ?? "application/octet-stream",
    transcript_s3_key: src.transcript_s3_key ?? null,
  };
}

export async function listSourceDocs(
  userId: string,
  workspaceId: number = getWorkspaceId()
): Promise<SourceDocument[]> {
  const res = await fetch(
    `${BASE}/api/sources?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`List sources failed: ${res.status}`); }
  const data: ApiSourceDocument[] = await res.json();
  return data.map(mapApiSource);
}

export async function uploadSourceDoc(
  userId: string,
  file: File,
  workspaceId: number = getWorkspaceId()
): Promise<SourceDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("workspace_id", String(workspaceId));

  const res = await fetch(`${BASE}/api/sources/upload`, {
    method: "POST",
    headers: authOnly(userId),
    body: form,
  });
  if (!res.ok) { handle401(res); throw new Error(`Upload failed: ${res.status}`); }
  const data: ApiSourceDocument = await res.json();
  return mapApiSource(data);
}

export async function deleteSourceDoc(
  userId: string,
  docId: number | string
): Promise<void> {
  const res = await fetch(`${BASE}/api/sources/${docId}`, {
    method: "DELETE",
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Delete failed: ${res.status}`); }
}

export interface ViewUrlResponse {
  url: string;
  content_type: string;
  filename: string;
}

export async function getSourceViewUrl(
  userId: string,
  docId: number | string
): Promise<ViewUrlResponse> {
  const res = await fetch(`${BASE}/api/sources/${docId}/view-url`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Get view URL failed: ${res.status}`); }
  return res.json();
}

// ── Figures ──────────────────────────────────────────────────────────────────

export async function listFigures(
  userId: string,
  workspaceId: number = getWorkspaceId()
): Promise<Figure[]> {
  const res = await fetch(
    `${BASE}/api/figures?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`List figures failed: ${res.status}`); }
  return res.json();
}

export async function listFiguresBySource(
  userId: string,
  sourceDocId: number | string
): Promise<Figure[]> {
  const res = await fetch(
    `${BASE}/api/figures/by-source/${sourceDocId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`List figures by source failed: ${res.status}`); }
  return res.json();
}

export async function listFiguresByClaim(
  userId: string,
  claimId: string
): Promise<Figure[]> {
  const res = await fetch(
    `${BASE}/api/figures/by-claim/${claimId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`List figures by claim failed: ${res.status}`); }
  return res.json();
}

export async function getFigureViewUrl(
  userId: string,
  figureId: number
): Promise<FigureViewUrlResponse> {
  const res = await fetch(
    `${BASE}/api/figures/${figureId}/view-url`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Get figure view URL failed: ${res.status}`); }
  return res.json();
}

export async function deleteFigure(
  userId: string,
  figureId: number
): Promise<void> {
  const res = await fetch(
    `${BASE}/api/figures/${figureId}`,
    { method: "DELETE", headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Delete figure failed: ${res.status}`); }
}

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(
  userId: string,
  title?: string,
  workspaceId: number = getWorkspaceId()
): Promise<ChatSessionResponse> {
  const res = await fetch(`${BASE}/api/chat/sessions`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ workspace_id: workspaceId, title: title ?? "New Chat" }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Create chat session failed: ${res.status}`); }
  return res.json();
}

export async function listChatSessions(
  userId: string,
  workspaceId: number = getWorkspaceId()
): Promise<ChatSessionListItem[]> {
  const res = await fetch(
    `${BASE}/api/chat/sessions?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`List chat sessions failed: ${res.status}`); }
  return res.json();
}

export async function getChatSession(
  userId: string,
  sessionId: number
): Promise<ChatSessionResponse> {
  const res = await fetch(`${BASE}/api/chat/sessions/${sessionId}`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Get chat session failed: ${res.status}`); }
  return res.json();
}

export async function deleteChatSession(
  userId: string,
  sessionId: number
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat/sessions/${sessionId}`, {
    method: "DELETE",
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Delete chat session failed: ${res.status}`); }
}

export async function sendChatMessage(
  userId: string,
  sessionId: number,
  content: string,
  image_s3_keys?: string[]
): Promise<ChatMessageResponse> {
  const payload: Record<string, unknown> = { content };
  if (image_s3_keys && image_s3_keys.length > 0) {
    payload.image_s3_keys = image_s3_keys;
  }
  const res = await fetch(
    `${BASE}/api/chat/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) { handle401(res); throw new Error(`Send message failed: ${res.status}`); }
  return res.json();
}

export async function uploadChatImage(
  userId: string,
  sessionId: number,
  file: File
): Promise<{ s3_key: string; content_type: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(
    `${BASE}/api/chat/sessions/${sessionId}/upload-image`,
    {
      method: "POST",
      headers: authOnly(userId),
      body: formData,
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Upload image failed (${res.status}): ${detail}`);
  }
  return res.json();
}

// ── Visual Activity ──────────────────────────────────────────────────────────

export async function uploadVisualActivityImage(
  userId: string,
  activityId: number,
  file: File
): Promise<{ s3_key: string; content_type: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(
    `${BASE}/api/activities/${activityId}/upload-visual-image`,
    {
      method: "POST",
      headers: authOnly(userId),
      body: formData,
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Upload visual image failed (${res.status}): ${detail}`);
  }
  return res.json();
}

export async function submitVisualResponse(
  userId: string,
  activityId: number,
  file: File,
  textResponse?: string
): Promise<AttemptResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (textResponse) formData.append("text_response", textResponse);
  const res = await fetch(
    `${BASE}/api/activities/${activityId}/submit-visual`,
    {
      method: "POST",
      headers: authOnly(userId),
      body: formData,
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Submit visual response failed (${res.status}): ${detail}`);
  }
  return res.json();
}

// ── Classroom / Teacher Dashboard ─────────────────────────────────────────────

export interface ClassroomResponse {
  id: number;
  teacher_id: string;
  title: string;
  join_code: string;
  created_at: string;
  student_count: number;
}

export interface StudentSummary {
  id: string;
  display_name: string;
  xp: number;
  level: number;
  joined_at: string;
}

export interface ClassroomDetail extends ClassroomResponse {
  students: StudentSummary[];
  shared_workspace_id: number | null;
}

export interface ClassroomDiagnosticResponse {
  classroom_id: number;
  student_ids: string[];
  claim_ids: string[];
  mastery_matrix: Record<string, Record<string, number>>;
}

export interface StudentProgressResponse {
  student_id: string;
  display_name: string | null;
  xp: number;
  level: number;
  streak_days: number;
  mastery: Array<{
    claim_id: string;
    understanding_rating: number;
    status: string;
  }>;
  activity_history: Array<{
    activity_id: number | null;
    claim_id: string | null;
    outcome: string;
    xp_awarded: number;
    attempted_at: string | null;
  }>;
}

export async function fetchTeacherClassrooms(
  userId: string
): Promise<ClassroomResponse[]> {
  const res = await fetch(`${BASE}/api/classrooms`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Classrooms fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchClassroomDetail(
  userId: string,
  classroomId: number
): Promise<ClassroomDetail> {
  const res = await fetch(`${BASE}/api/classrooms/${classroomId}`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Classroom detail fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchClassroomDiagnostic(
  userId: string,
  classroomId: number
): Promise<ClassroomDiagnosticResponse> {
  const res = await fetch(
    `${BASE}/api/classrooms/${classroomId}/diagnostic`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Diagnostic fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchStudentProgress(
  userId: string,
  classroomId: number,
  studentId: string
): Promise<StudentProgressResponse> {
  const res = await fetch(
    `${BASE}/api/classrooms/${classroomId}/students/${studentId}/progress`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Student progress fetch failed: ${res.status}`); }
  return res.json();
}

export interface LeaderboardEntry {
  rank: number;
  student_id: string;
  display_name: string;
  xp: number;
  level: number;
}

export async function fetchClassroomLeaderboard(
  userId: string,
  classroomId: number
): Promise<LeaderboardEntry[]> {
  const res = await fetch(
    `${BASE}/api/classrooms/${classroomId}/leaderboard`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Leaderboard fetch failed: ${res.status}`); }
  return res.json();
}

// ── Activity History ────────────────────────────────────────────────────────

export interface ActivityHistoryItem {
  id: number;
  student_id: string;
  student_name: string;
  activity_type: string;
  activity_title: string;
  claim_title: string | null;
  outcome: string;
  student_response: string | null;
  feedback: string | null;
  xp_awarded: number;
  attempted_at: string | null;
  activity_payload?: Record<string, any> | null;
}

export interface ActivityHistoryResponse {
  classroom_id: number;
  items: ActivityHistoryItem[];
  total: number;
}

export async function fetchClassroomActivityHistory(
  userId: string,
  classroomId: number,
  limit: number = 50,
  offset: number = 0
): Promise<ActivityHistoryResponse> {
  const res = await fetch(
    `${BASE}/api/classrooms/${classroomId}/activity-history?limit=${limit}&offset=${offset}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Activity history fetch failed: ${res.status}`); }
  return res.json();
}

// ── Class Chat History ───────────────────────────────────────────────────────

export interface ClassChatSessionItem {
  session_id: number;
  student_name: string;
  student_id: string;
  title: string | null;
  message_count: number;
  created_at: string | null;
}

export interface ClassChatHistoryResponse {
  items: ClassChatSessionItem[];
  total: number;
}

export interface ClassChatMessageItem {
  role: "user" | "assistant";
  content: string;
  created_at: string | null;
}

export interface ClassChatSessionDetail {
  session_id: number;
  student_name: string;
  student_id: string;
  title: string | null;
  created_at: string | null;
  messages: ClassChatMessageItem[];
}

export async function fetchClassroomChatHistory(
  userId: string,
  classroomId: number,
  limit: number = 50,
  offset: number = 0
): Promise<ClassChatHistoryResponse> {
  const res = await fetch(
    `${BASE}/api/classrooms/${classroomId}/chat-history?limit=${limit}&offset=${offset}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Chat history fetch failed: ${res.status}`); }
  return res.json();
}

export async function fetchClassroomChatSession(
  userId: string,
  classroomId: number,
  sessionId: number
): Promise<ClassChatSessionDetail> {
  const res = await fetch(
    `${BASE}/api/classrooms/${classroomId}/chat-history/${sessionId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Chat session fetch failed: ${res.status}`); }
  return res.json();
}

// ── Glossary ─────────────────────────────────────────────────────────────────

export async function fetchGlossaryTerms(
  userId: string,
  workspaceId: number = getWorkspaceId()
): Promise<GlossaryTermResponse[]> {
  const res = await fetch(
    `${BASE}/api/glossary?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) { handle401(res); throw new Error(`Glossary fetch failed: ${res.status}`); }
  return res.json();
}

export async function searchGlossary(
  userId: string,
  query: string,
  workspaceId: number = getWorkspaceId(),
  limit: number = 20
): Promise<GlossarySearchResponse> {
  const res = await fetch(`${BASE}/api/glossary/search`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ query, workspace_id: workspaceId, limit }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Glossary search failed: ${res.status}`); }
  return res.json();
}

export async function createGlossaryTerm(
  userId: string,
  term: string,
  definition: string,
  workspaceId: number = getWorkspaceId(),
  sourceDocumentId?: number
): Promise<GlossaryTermResponse> {
  const payload: Record<string, unknown> = { workspace_id: workspaceId, term, definition };
  if (sourceDocumentId != null) payload.source_document_id = sourceDocumentId;
  const res = await fetch(`${BASE}/api/glossary`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify(payload),
  });
  if (!res.ok) { handle401(res); throw new Error(`Create glossary term failed: ${res.status}`); }
  return res.json();
}

export async function updateGlossaryTerm(
  userId: string,
  termId: number,
  data: { term?: string; definition?: string }
): Promise<GlossaryTermResponse> {
  const res = await fetch(`${BASE}/api/glossary/${termId}`, {
    method: "PUT",
    headers: headers(userId),
    body: JSON.stringify(data),
  });
  if (!res.ok) { handle401(res); throw new Error(`Update glossary term failed: ${res.status}`); }
  return res.json();
}

export async function deleteGlossaryTerm(
  userId: string,
  termId: number
): Promise<void> {
  const res = await fetch(`${BASE}/api/glossary/${termId}`, {
    method: "DELETE",
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`Delete glossary term failed: ${res.status}`); }
}

// ── Audio overview ──────────────────────────────────────────────────────────

export interface GenerateAudioOverviewRequest {
  workspace_id?: number;
  topic_ids: string[];
  style: "conversational" | "narrative" | "discussion";
  user_instruction?: string;
}

export interface AudioOverviewResponse {
  activity_id: number;
  title: string;
  audio_url: string;
  s3_key: string;
  script: string;
  question: string;
  style: string;
  duration_seconds: number | null;
}

export async function generateAudioOverview(
  userId: string,
  body: GenerateAudioOverviewRequest
): Promise<AudioOverviewResponse> {
  const res = await fetch(`${BASE}/api/audio/generate-overview`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ workspace_id: body.workspace_id ?? getWorkspaceId(), ...body }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Audio overview generation failed: ${res.status}`); }
  return res.json();
}

// ── Workbenches ─────────────────────────────────────────────────────────────

export async function listWorkbenches(
  userId: string
): Promise<WorkbenchResponse[]> {
  const res = await fetch(`${BASE}/api/workspaces`, {
    headers: headers(userId),
  });
  if (!res.ok) { handle401(res); throw new Error(`List workbenches failed: ${res.status}`); }
  const data = await res.json();
  return data.workspaces;
}

export async function createWorkbench(
  userId: string,
  title: string,
  description?: string
): Promise<WorkbenchResponse> {
  const res = await fetch(`${BASE}/api/workspaces`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ title, description: description || null }),
  });
  if (!res.ok) { handle401(res); throw new Error(`Create workbench failed: ${res.status}`); }
  return res.json();
}
