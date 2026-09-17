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
  FrontierResponse,
  GraphResponse,
  HistoryEvent,
  MasteryEntry,
  QueueResponse,
  SourceDocument,
  TopicSummary,
  UserProfile,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEMO_WORKSPACE_ID = 1;

function headers(userId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Demo-User": userId,
  };
}

// ── Activity feed / evaluate ──────────────────────────────────────────────────

export async function fetchActivityFeed(
  userId: string,
  limit = 20,
  offset = 0
): Promise<ActivityFeedResponse> {
  const res = await fetch(
    `${BASE}/api/activities/feed?limit=${limit}&offset=${offset}`,
    { headers: headers(userId) }
  );
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Evaluate failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Attempt failed: ${res.status}`);
  return res.json();
}

export async function fetchActivityQueue(
  userId: string,
  limit = 20,
  offset = 0
): Promise<QueueResponse> {
  const res = await fetch(
    `${BASE}/api/activities/queue?limit=${limit}&offset=${offset}`,
    { headers: headers(userId) }
  );
  if (!res.ok) throw new Error(`Queue fetch failed: ${res.status}`);
  return res.json();
}

// ── Frontier ──────────────────────────────────────────────────────────────────

export async function fetchFrontier(
  userId: string
): Promise<FrontierResponse> {
  const res = await fetch(`${BASE}/api/frontier`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`Frontier fetch failed: ${res.status}`);
  return res.json();
}

// ── User profile / mastery / history ──────────────────────────────────────────

export async function fetchUserProfile(
  userId: string
): Promise<UserProfile> {
  const res = await fetch(`${BASE}/api/users/me`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`User profile fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchUserMastery(
  userId: string
): Promise<MasteryEntry[]> {
  const res = await fetch(`${BASE}/api/users/me/mastery`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`Mastery fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchUserHistory(
  userId: string
): Promise<HistoryEvent[]> {
  const res = await fetch(`${BASE}/api/users/me/history`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
  return res.json();
}

// ── Topics / claims (wiki wiring) ─────────────────────────────────────────────

export async function fetchTopics(
  userId: string,
  workspaceId = DEMO_WORKSPACE_ID
): Promise<TopicSummary[]> {
  const res = await fetch(
    `${BASE}/api/topics?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) throw new Error(`Topics fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchClaims(
  userId: string,
  workspaceId = DEMO_WORKSPACE_ID
): Promise<ClaimResponse[]> {
  const res = await fetch(
    `${BASE}/api/claims?workspace_id=${workspaceId}&limit=200`,
    { headers: headers(userId) }
  );
  if (!res.ok) throw new Error(`Claims fetch failed: ${res.status}`);
  return res.json();
}

// ── Graph (node map) ──────────────────────────────────────────────────────────

export async function fetchGraph(
  userId: string
): Promise<GraphResponse> {
  const res = await fetch(`${BASE}/api/dag/graph`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`Graph fetch failed: ${res.status}`);
  return res.json();
}

// ── Source documents ──────────────────────────────────────────────────────────

function mapApiSource(src: ApiSourceDocument): SourceDocument {
  return {
    id: String(src.id),
    filename: src.filename,
    size_bytes: src.size_bytes ?? 0,
    uploaded_at: src.created_at,
    status: (src.status === "uploaded" ? "processing" : src.status) as SourceDocument["status"],
    claim_count: src.claim_count ?? 0,
  };
}

export async function listSourceDocs(
  userId: string,
  workspaceId: number = DEMO_WORKSPACE_ID
): Promise<SourceDocument[]> {
  const res = await fetch(
    `${BASE}/api/sources?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) throw new Error(`List sources failed: ${res.status}`);
  const data: ApiSourceDocument[] = await res.json();
  return data.map(mapApiSource);
}

export async function uploadSourceDoc(
  userId: string,
  file: File,
  workspaceId: number = DEMO_WORKSPACE_ID
): Promise<SourceDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("workspace_id", String(workspaceId));

  const res = await fetch(`${BASE}/api/sources/upload`, {
    method: "POST",
    headers: { "X-Demo-User": userId },
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(
  userId: string,
  title?: string,
  workspaceId: number = DEMO_WORKSPACE_ID
): Promise<ChatSessionResponse> {
  const res = await fetch(`${BASE}/api/chat/sessions`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify({ workspace_id: workspaceId, title: title ?? "New Chat" }),
  });
  if (!res.ok) throw new Error(`Create chat session failed: ${res.status}`);
  return res.json();
}

export async function listChatSessions(
  userId: string,
  workspaceId: number = DEMO_WORKSPACE_ID
): Promise<ChatSessionListItem[]> {
  const res = await fetch(
    `${BASE}/api/chat/sessions?workspace_id=${workspaceId}`,
    { headers: headers(userId) }
  );
  if (!res.ok) throw new Error(`List chat sessions failed: ${res.status}`);
  return res.json();
}

export async function getChatSession(
  userId: string,
  sessionId: number
): Promise<ChatSessionResponse> {
  const res = await fetch(`${BASE}/api/chat/sessions/${sessionId}`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`Get chat session failed: ${res.status}`);
  return res.json();
}

export async function sendChatMessage(
  userId: string,
  sessionId: number,
  content: string
): Promise<ChatMessageResponse> {
  const res = await fetch(
    `${BASE}/api/chat/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(`Send message failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Classrooms fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchClassroomDetail(
  userId: string,
  classroomId: number
): Promise<ClassroomDetail> {
  const res = await fetch(`${BASE}/api/classrooms/${classroomId}`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`Classroom detail fetch failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Diagnostic fetch failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Student progress fetch failed: ${res.status}`);
  return res.json();
}
