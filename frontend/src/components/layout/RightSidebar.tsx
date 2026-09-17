"use client";

import { useState, useEffect, useCallback } from "react";
import { Flame, Trophy, ArrowLeft, Medal, Crown, ChevronDown, ChevronUp, MessageSquare, Bot } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { UserProfile, MasteryEntry, HistoryEvent, ClaimResponse, TopicSummary, ViewTab } from "@/lib/types";
import type { CompletedActivityReview } from "@/components/activity/CompletedActivityReviewOverlay";
import { formatXP } from "@/lib/utils";
import {
  fetchUserProfile,
  fetchUserMastery,
  fetchUserHistory,
  fetchTeacherClassrooms,
  fetchClassroomLeaderboard,
  fetchClassroomDiagnostic,
  fetchTopics,
  fetchClaims,
} from "@/lib/api";
import type { LeaderboardEntry, ClassroomDiagnosticResponse } from "@/lib/api";

interface RightSidebarProps {
  user: UserProfile;
  onActivityClick?: (activityId: string) => void;
  userRole?: UserProfile["role"];
  onTabChange?: (tab: ViewTab) => void;
  onReviewActivity?: (review: CompletedActivityReview) => void;
}

const LEADERBOARD = [
  { rank: 1, name: "Maya R.", xp: 2480, streak: 12, level: 13 },
  { rank: 2, name: "Jordan L.", xp: 2210, streak: 9, level: 12 },
  { rank: 3, name: "Sam T.", xp: 1950, streak: 6, level: 10 },
  { rank: 4, name: "Alex K.", xp: 1720, streak: 8, level: 9 },
  { rank: 5, name: "Taylor M.", xp: 1540, streak: 4, level: 8 },
  { rank: 6, name: "Casey P.", xp: 1380, streak: 5, level: 7 },
  { rank: 7, name: "Morgan W.", xp: 1120, streak: 3, level: 6 },
  { rank: 8, name: "Riley J.", xp: 940, streak: 2, level: 5 },
];

const DOMAIN_MASTERY = [
  { domain: "Linear Algebra", percent: 78 },
  { domain: "Data Structures", percent: 45 },
  { domain: "Discrete Math", percent: 92 },
];

interface TimelineEntry {
  color: string;
  title: string;
  xp: number;
  time: string;
  activityId: string;
  activityType: string;
  studentResponse: string | null;
  feedback: string | null;
  outcome: string;
  payload?: Record<string, any> | null;
}

const STUDENT_ACTIVITY: TimelineEntry[] = [
  {
    color: "bg-blue-500",
    title: "Completed Flashcard: Gaussian Elimination",
    xp: 25,
    time: "10m ago",
    activityId: "act_fc_1",
    activityType: "flashcard",
    studentResponse: "Row reduction transforms the augmented matrix to echelon form using elementary row operations.",
    feedback: "Correct! You've identified the core process of Gaussian elimination.",
    outcome: "understood",
  },
  {
    color: "bg-blue-600",
    title: "Passed Quiz: Identifying Pivot Positions",
    xp: 60,
    time: "1h ago",
    activityId: "act_quiz_1",
    activityType: "quiz",
    studentResponse: JSON.stringify({ 0: 1, 1: true, 2: "The pivot is the first nonzero entry in each row of the echelon form.", 3: ["pivot", "column"] }),
    feedback: "Great job! You scored 4/4 on this quiz. You clearly understand how to identify pivot positions in a matrix.",
    outcome: "understood",
    payload: {
      questions: [
        {
          type: "multi_choice",
          question: "Which element is the pivot in the first row of [2 4 1; 0 3 5; 0 0 7]?",
          options: ["4", "2", "1", "7"],
          correct_index: 1,
        },
        {
          type: "true_false",
          statement: "A pivot position can never be in a column that already contains another pivot.",
          correct_answer: true,
          explanation: "Each column can have at most one pivot position in reduced echelon form.",
        },
        {
          type: "short_answer",
          prompt: "Describe how to identify pivot positions after row reducing a matrix.",
        },
        {
          type: "fill_blank",
          sentence: "The leading entry in each nonzero row is called a ___ and its column is a ___ column.",
          blanks: ["pivot", "column"],
        },
      ],
    },
  },
  {
    color: "bg-gray-400",
    title: "Attempted Feynman: Elementary Row Ops",
    xp: 50,
    time: "Yesterday",
    activityId: "act_fy_1",
    activityType: "feynman",
    studentResponse: "You can swap rows and multiply by constants.",
    feedback: "Partially correct. There are three elementary row operations: row swap, scalar multiplication, and adding a multiple of one row to another. You missed the third.",
    outcome: "did_not_understand",
  },
];

const CLASS_ACTIVITY: TimelineEntry[] = [
  {
    color: "bg-blue-500",
    title: "Alex K. completed Flashcard: Gaussian Elimination",
    xp: 25,
    time: "10m ago",
    activityId: "act_fc_1",
    activityType: "flashcard",
    studentResponse: "It's a method to solve systems of linear equations by reducing the matrix.",
    feedback: "Good summary! Gaussian elimination systematically reduces a matrix to row echelon form.",
    outcome: "understood",
  },
  {
    color: "bg-purple-500",
    title: "Maya R. started Feynman: Elementary Row Ops",
    xp: 50,
    time: "25m ago",
    activityId: "act_fy_1",
    activityType: "feynman",
    studentResponse: null,
    feedback: null,
    outcome: "neutral",
  },
  {
    color: "bg-blue-600",
    title: "Jordan L. completed Scenario: Network Flow",
    xp: 100,
    time: "1h ago",
    activityId: "act_sc_1",
    activityType: "scenario",
    studentResponse: "The max flow equals the min cut by the max-flow min-cut theorem.",
    feedback: "Excellent application of the theorem to the network scenario!",
    outcome: "understood",
  },
  {
    color: "bg-emerald-500",
    title: "Sam T. passed Quiz: Back Substitution",
    xp: 60,
    time: "2h ago",
    activityId: "act_quiz_1",
    activityType: "quiz",
    studentResponse: "Start from the bottom row and solve for each variable moving upward.",
    feedback: "Correct! Back substitution works upward through the triangular system.",
    outcome: "understood",
  },
];

/** Convert an ISO timestamp to a human-friendly relative string. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

/** Build domain-mastery percentages from per-claim mastery entries. */
function buildDomainMastery(
  entries: MasteryEntry[]
): { domain: string; percent: number }[] {
  const byTopic = new Map<string, { total: number; mastered: number }>();
  for (const e of entries) {
    const cur = byTopic.get(e.topic_title) ?? { total: 0, mastered: 0 };
    cur.total += 1;
    if (e.status === "mastered") cur.mastered += 1;
    byTopic.set(e.topic_title, cur);
  }
  return Array.from(byTopic.entries())
    .map(([domain, { total, mastered }]) => ({
      domain,
      percent: total > 0 ? Math.round((mastered / total) * 100) : 0,
    }))
    .sort((a, b) => b.percent - a.percent);
}

/** Build class-wide domain mastery from the diagnostic matrix, claims, and topics. */
function buildClassMastery(
  diagnostic: ClassroomDiagnosticResponse,
  claims: ClaimResponse[],
  topics: TopicSummary[]
): { domain: string; percent: number }[] {
  const topicMap = new Map(topics.map((t) => [t.id, t.title]));
  const claimToTopic = new Map(
    claims.map((c) => [c.id, topicMap.get(c.topic_id) ?? "Unknown"])
  );

  const byTopic = new Map<string, { totalRating: number; count: number }>();
  const studentIds = Object.keys(diagnostic.mastery_matrix);
  for (const sid of studentIds) {
    const studentClaims = diagnostic.mastery_matrix[sid];
    for (const [claimId, rating] of Object.entries(studentClaims)) {
      const topicTitle = claimToTopic.get(claimId) ?? "Unknown";
      const cur = byTopic.get(topicTitle) ?? { totalRating: 0, count: 0 };
      cur.totalRating += rating;
      cur.count += 1;
      byTopic.set(topicTitle, cur);
    }
  }

  return Array.from(byTopic.entries())
    .map(([domain, { totalRating, count }]) => ({
      domain,
      percent: count > 0 ? Math.round(totalRating / count) : 0,
    }))
    .sort((a, b) => b.percent - a.percent);
}

/** Convert backend history events to the timeline format used in the sidebar. */
function historyToTimeline(events: HistoryEvent[]): TimelineEntry[] {
  return events.slice(0, 5).map((e) => ({
    color: e.is_correct ? "bg-emerald-500" : "bg-red-400",
    title: e.is_correct
      ? `Completed: ${e.claim_title}`
      : `Attempted: ${e.claim_title}`,
    xp: e.xp_awarded,
    time: relativeTime(e.timestamp),
    activityId: e.claim_id,
    activityType: (e as HistoryEvent & { activity_type?: string }).activity_type ?? "",
    studentResponse: e.student_response,
    feedback: e.feedback,
    outcome: e.outcome,
  }));
}

function timelineEntryToReview(entry: TimelineEntry, isTeacher: boolean): CompletedActivityReview {
  const nameMatch = isTeacher ? entry.title.match(/^(\S+\s\S\.?)/) : null;
  return {
    id: entry.activityId,
    activityType: entry.activityType,
    activityTitle: entry.title,
    claimTitle: null,
    topic: null,
    studentName: nameMatch ? nameMatch[1] : null,
    studentResponse: entry.studentResponse,
    feedback: entry.feedback,
    outcome: entry.outcome,
    xpAwarded: entry.xp,
    attemptedAt: null,
    payload: entry.payload ?? null,
  };
}

export function RightSidebar({ user, onActivityClick, userRole, onTabChange, onReviewActivity }: RightSidebarProps) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // ── Real data state (falls back to hardcoded) ──────────────────────────────
  const [liveProfile, setLiveProfile] = useState<UserProfile | null>(null);
  const [domainMastery, setDomainMastery] = useState<
    { domain: string; percent: number }[] | null
  >(null);
  const [activityTimeline, setActivityTimeline] = useState<TimelineEntry[] | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleExpand = useCallback((i: number) => {
    setExpandedIndex((prev) => (prev === i ? null : i));
  }, []);

  // ── Teacher-specific state ────────────────────────────────────────────────
  const [liveLeaderboard, setLiveLeaderboard] = useState<LeaderboardEntry[] | null>(null);

  const isTeacher = userRole ? userRole === "teacher" : (liveProfile ?? user).role === "teacher";

  // ── Load student data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user.id) return;
    let cancelled = false;

    async function load() {
      try {
        const [profile, mastery, history] = await Promise.all([
          fetchUserProfile(user.id).catch((err) => { console.error("RightSidebar: failed to fetch user profile:", err); return null; }),
          fetchUserMastery(user.id).catch((err) => { console.error("RightSidebar: failed to fetch user mastery:", err); return null; }),
          fetchUserHistory(user.id).catch((err) => { console.error("RightSidebar: failed to fetch user history:", err); return null; }),
        ]);
        if (cancelled) return;
        if (profile) setLiveProfile(profile);
        if (profile?.role !== "teacher") {
          if (mastery && mastery.length > 0) {
            setDomainMastery(buildDomainMastery(mastery));
          }
        }
        if (history && history.length > 0) {
          setActivityTimeline(historyToTimeline(history));
        }
      } catch (err) {
        console.error("RightSidebar: failed to load student data:", err);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user.id]);

  // ── Load teacher-specific data (leaderboard + class mastery) ──────────────
  useEffect(() => {
    if (!user.id || !isTeacher) return;
    let cancelled = false;

    async function loadTeacher() {
      try {
        const classrooms = await fetchTeacherClassrooms(user.id);
        if (cancelled || classrooms.length === 0) return;
        const classroom = classrooms[0];

        const [leaderboard, diagnostic, topics, claims] = await Promise.all([
          fetchClassroomLeaderboard(user.id, classroom.id).catch((err) => { console.error("RightSidebar: failed to fetch leaderboard:", err); return null; }),
          fetchClassroomDiagnostic(user.id, classroom.id).catch((err) => { console.error("RightSidebar: failed to fetch diagnostic:", err); return null; }),
          fetchTopics(user.id).catch((err) => { console.error("RightSidebar: failed to fetch topics:", err); return null; }),
          fetchClaims(user.id).catch((err) => { console.error("RightSidebar: failed to fetch claims:", err); return null; }),
        ]);
        if (cancelled) return;

        if (leaderboard && leaderboard.length > 0) {
          setLiveLeaderboard(leaderboard);
        }
        if (diagnostic && topics && claims && topics.length > 0) {
          setDomainMastery(buildClassMastery(diagnostic, claims, topics));
        }
      } catch (err) {
        console.error("RightSidebar: failed to load teacher data:", err);
      }
    }

    loadTeacher();
    return () => { cancelled = true; };
  }, [user.id, isTeacher]);

  // Prefer live profile, fall back to prop
  const displayUser = liveProfile ?? user;

  const xpForNextLevel = displayUser.level * 200;
  const xpInCurrentLevel = displayUser.xp - (displayUser.level - 1) * 200;
  const progressPercent = Math.min(
    Math.round((xpInCurrentLevel / 200) * 100),
    100
  );
  const xpRemaining = xpForNextLevel - displayUser.xp;

  // Domain mastery: use live data or hardcoded fallback
  const displayMastery = domainMastery ?? DOMAIN_MASTERY;

  // Activity timeline: use live data or hardcoded fallback
  const recentActivity =
    activityTimeline ?? (isTeacher ? CLASS_ACTIVITY : STUDENT_ACTIVITY);

  // Leaderboard entries for teacher inline view or student toggle view
  const leaderboardEntries = liveLeaderboard
    ? liveLeaderboard.map((e) => ({
        rank: e.rank,
        name: e.display_name,
        xp: e.xp,
        level: e.level,
      }))
    : LEADERBOARD;

  // ── Student leaderboard toggle view ───────────────────────────────────────
  if (!isTeacher && showLeaderboard) {
    return (
      <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l bg-background">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLeaderboard(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Trophy className="h-4 w-4 text-amber-500" />
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Leaderboard
            </p>
          </div>
        </div>

        <Separator />

        <div className="px-5 py-4">
          <div className="space-y-1">
            {leaderboardEntries.map((s) => (
              <div
                key={s.rank}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                  s.rank <= 3 ? "bg-accent/40" : ""
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                  {s.rank === 1 ? (
                    <Crown className="h-5 w-5 text-amber-500" />
                  ) : s.rank <= 3 ? (
                    <Medal className={`h-5 w-5 ${s.rank === 2 ? "text-gray-400" : "text-amber-700"}`} />
                  ) : (
                    <span className="font-mono text-sm font-semibold text-muted-foreground">
                      {s.rank}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    Lvl {s.level}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-xp">
                  {formatXP(s.xp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l bg-background">
      {/* ── Teacher: inline leaderboard replaces XP block ── */}
      {isTeacher ? (
        <div className="px-5 py-5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Class Leaderboard
            </p>
          </div>
          <div className={`mt-3 space-y-1 ${leaderboardEntries.length > 7 ? "max-h-[320px] overflow-y-auto pr-1" : ""}`}>
            {leaderboardEntries.map((s) => (
              <div
                key={s.rank}
                className={`flex items-center gap-3 rounded-lg px-2 py-2 ${
                  s.rank <= 3 ? "bg-accent/40" : ""
                }`}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {s.rank === 1 ? (
                    <Crown className="h-4 w-4 text-amber-500" />
                  ) : s.rank <= 3 ? (
                    <Medal className={`h-4 w-4 ${s.rank === 2 ? "text-gray-400" : "text-amber-700"}`} />
                  ) : (
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      {s.rank}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    Lvl {s.level}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-xp">
                  {formatXP(s.xp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Student: XP / Level block ── */
        <div className="px-5 py-5">
          <div className="flex items-start justify-between">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Level {displayUser.level} Explorer
            </p>
            <button
              onClick={() => setShowLeaderboard(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-accent"
              title="Leaderboard"
            >
              <Trophy className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2">
            <span className="text-3xl font-bold tabular-nums tracking-tight">
              {formatXP(displayUser.xp)}
            </span>
            <span className="ml-1 text-sm text-muted-foreground">XP</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {xpRemaining > 0
              ? `${xpRemaining} XP remaining to Level ${displayUser.level + 1}`
              : "Max level reached"}
          </p>

          <Progress
            value={progressPercent}
            className="mt-3 h-1.5"
            indicatorClassName="bg-xp"
          />

          <div className="mt-3 flex items-center gap-2 text-xs">
            <Flame className="h-3.5 w-3.5 text-orange-400" />
            <span className="font-medium">{displayUser.streak_days ?? 0}-day streak</span>
            <span className="ml-auto font-mono text-muted-foreground">
              Top 4%
            </span>
          </div>
        </div>
      )}

      <Separator />

      {/* Domain mastery */}
      <div className="px-5 py-4">
        <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {isTeacher ? "Class Mastery" : "Axiom Mastery"}
        </p>
        <div className={`space-y-2.5 ${displayMastery.length > 5 ? "max-h-[180px] overflow-y-auto pr-1" : ""}`}>
          {displayMastery.map((d) => (
            <div key={d.domain} className="flex items-center justify-between">
              <span className="text-sm">{d.domain}</span>
              <div className="flex items-center gap-2">
                <div className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${d.percent}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-xs text-muted-foreground">
                  {d.percent}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Recent activity timeline */}
      <div className="px-5 py-4">
        {isTeacher ? (
          <button
            onClick={() => onTabChange?.("dashboard")}
            className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-primary hover:underline"
          >
            Class Activity →
          </button>
        ) : (
          <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Recent Activity
          </p>
        )}
        <div className="space-y-1">
          {recentActivity.map((a, i) => {
            const hasDetail = a.studentResponse || a.feedback;
            const isExpanded = expandedIndex === i;
            return (
              <div key={i}>
                <button
                  onClick={() => {
                    if (hasDetail && onReviewActivity) {
                      onReviewActivity(timelineEntryToReview(a, isTeacher));
                    } else if (hasDetail) {
                      toggleExpand(i);
                    } else {
                      onActivityClick?.(a.activityId);
                    }
                  }}
                  className="flex w-full gap-3 text-left transition-colors hover:opacity-80"
                >
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${a.color}`}
                    />
                    {i < recentActivity.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="text-sm font-medium leading-snug">{a.title}</p>
                    <p className="mt-0.5 font-mono text-xs">
                      <span className="text-xp">+{a.xp} XP</span>
                      <span className="mx-1 text-muted-foreground">&middot;</span>
                      <span className="text-muted-foreground">{a.time}</span>
                    </p>
                  </div>
                  {hasDetail && (
                    <div className="mt-1 shrink-0 text-muted-foreground">
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </div>
                  )}
                </button>
                {isExpanded && hasDetail && (
                  <div className="ml-[22px] mb-2 space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
                    {a.studentResponse && (
                      <div>
                        <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                          <MessageSquare className="h-3 w-3" />
                          <span className="font-mono text-[10px] font-semibold uppercase">Response</span>
                        </div>
                        <p className="text-xs leading-relaxed">{a.studentResponse}</p>
                      </div>
                    )}
                    {a.feedback && (
                      <div>
                        <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                          <Bot className="h-3 w-3" />
                          <span className="font-mono text-[10px] font-semibold uppercase">Feedback</span>
                        </div>
                        <p className="text-xs leading-relaxed">{a.feedback}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
