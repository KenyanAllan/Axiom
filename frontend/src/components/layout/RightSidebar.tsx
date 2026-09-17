"use client";

import { useState, useEffect } from "react";
import { Flame, Trophy, ArrowLeft, Medal, Crown } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { UserProfile, MasteryEntry, HistoryEvent } from "@/lib/types";
import { formatXP } from "@/lib/utils";
import {
  fetchUserProfile,
  fetchUserMastery,
  fetchUserHistory,
} from "@/lib/api";

interface RightSidebarProps {
  user: UserProfile;
  onActivityClick?: (activityId: string) => void;
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

const STUDENT_ACTIVITY = [
  {
    color: "bg-blue-500",
    title: "Completed Flashcard: Gaussian Elimination",
    xp: 25,
    time: "10m ago",
    activityId: "act_fc_1",
  },
  {
    color: "bg-blue-600",
    title: "Passed Multi-Choice: Identifying Pivot Positions",
    xp: 50,
    time: "1h ago",
    activityId: "act_mc_1",
  },
  {
    color: "bg-gray-400",
    title: "Mastered True/False: Echelon Form Uniqueness",
    xp: 30,
    time: "Yesterday",
    activityId: "act_tf_1",
  },
];

const CLASS_ACTIVITY = [
  {
    color: "bg-blue-500",
    title: "Alex K. completed Flashcard: Gaussian Elimination",
    xp: 25,
    time: "10m ago",
    activityId: "act_fc_1",
  },
  {
    color: "bg-purple-500",
    title: "Maya R. started Feynman: Elementary Row Ops",
    xp: 50,
    time: "25m ago",
    activityId: "act_fy_1",
  },
  {
    color: "bg-blue-600",
    title: "Jordan L. completed Scenario: Network Flow",
    xp: 100,
    time: "1h ago",
    activityId: "act_sc_1",
  },
  {
    color: "bg-emerald-500",
    title: "Sam T. mastered Short Answer: Back Substitution",
    xp: 75,
    time: "2h ago",
    activityId: "act_sa_1",
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
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 6);
}

/** Convert backend history events to the timeline format used in the sidebar. */
function historyToTimeline(
  events: HistoryEvent[]
): {
  color: string;
  title: string;
  xp: number;
  time: string;
  activityId: string;
}[] {
  return events.slice(0, 5).map((e) => ({
    color: e.is_correct ? "bg-emerald-500" : "bg-red-400",
    title: e.is_correct
      ? `Completed: ${e.claim_title}`
      : `Attempted: ${e.claim_title}`,
    xp: e.xp_awarded,
    time: relativeTime(e.timestamp),
    activityId: e.claim_id,
  }));
}

export function RightSidebar({ user, onActivityClick }: RightSidebarProps) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // ── Real data state (falls back to hardcoded) ──────────────────────────────
  const [liveProfile, setLiveProfile] = useState<UserProfile | null>(null);
  const [domainMastery, setDomainMastery] = useState<
    { domain: string; percent: number }[] | null
  >(null);
  const [activityTimeline, setActivityTimeline] = useState<
    {
      color: string;
      title: string;
      xp: number;
      time: string;
      activityId: string;
    }[] | null
  >(null);

  useEffect(() => {
    if (!user.id) return;
    let cancelled = false;

    async function load() {
      try {
        const [profile, mastery, history] = await Promise.all([
          fetchUserProfile(user.id).catch(() => null),
          fetchUserMastery(user.id).catch(() => null),
          fetchUserHistory(user.id).catch(() => null),
        ]);
        if (cancelled) return;
        if (profile) setLiveProfile(profile);
        if (mastery && mastery.length > 0) {
          setDomainMastery(buildDomainMastery(mastery));
        }
        if (history && history.length > 0) {
          setActivityTimeline(historyToTimeline(history));
        }
      } catch {
        // Silently keep fallback data
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user.id]);

  // Prefer live profile, fall back to prop
  const displayUser = liveProfile ?? user;

  const xpForNextLevel = displayUser.level * 200;
  const xpInCurrentLevel = displayUser.xp - (displayUser.level - 1) * 200;
  const progressPercent = Math.min(
    Math.round((xpInCurrentLevel / 200) * 100),
    100
  );
  const xpRemaining = xpForNextLevel - displayUser.xp;

  const isTeacher = displayUser.role === "teacher";

  // Domain mastery: use live data or hardcoded fallback
  const displayMastery = domainMastery ?? DOMAIN_MASTERY;

  // Activity timeline: use live data or hardcoded fallback
  const recentActivity =
    activityTimeline ?? (isTeacher ? CLASS_ACTIVITY : STUDENT_ACTIVITY);

  if (showLeaderboard) {
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
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Leaderboard
            </p>
          </div>
        </div>

        <Separator />

        <div className="px-5 py-4">
          <div className="space-y-1">
            {LEADERBOARD.map((s) => (
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
                    Lvl {s.level} &middot; {s.streak}d streak
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
      {/* XP / Level block */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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

      <Separator />

      {/* Domain mastery */}
      <div className="px-5 py-4">
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Domain Mastery
        </p>
        <div className="space-y-2.5">
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
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {isTeacher ? "Class Activity" : "Recent Activity"}
        </p>
        <div className="space-y-4">
          {recentActivity.map((a, i) => (
            <button
              key={i}
              onClick={() => onActivityClick?.(a.activityId)}
              className="flex w-full gap-3 text-left transition-colors hover:opacity-80"
            >
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 h-2.5 w-2.5 rounded-full ${a.color}`}
                />
                {i < recentActivity.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-border" />
                )}
              </div>
              <div className="min-w-0 pb-1">
                <p className="text-sm font-medium leading-snug">{a.title}</p>
                <p className="mt-0.5 font-mono text-xs">
                  <span className="text-xp">+{a.xp} XP</span>
                  <span className="mx-1 text-muted-foreground">&middot;</span>
                  <span className="text-muted-foreground">{a.time}</span>
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
