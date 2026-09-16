import type {
  ActivityFeedResponse,
  EvaluateRequest,
  EvaluateResult,
  FrontierResponse,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function headers(userId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Demo-User": userId,
  };
}

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

export async function fetchFrontier(
  userId: string
): Promise<FrontierResponse> {
  const res = await fetch(`${BASE}/api/frontier`, {
    headers: headers(userId),
  });
  if (!res.ok) throw new Error(`Frontier fetch failed: ${res.status}`);
  return res.json();
}
