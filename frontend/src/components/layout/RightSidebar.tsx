"use client";

import { useState } from "react";
import { Flame, Trophy, ArrowLeft, Medal, Crown } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { UserProfile } from "@/lib/types";
import { formatXP } from "@/lib/utils";

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

export function RightSidebar({ user, onActivityClick }: RightSidebarProps) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const xpForNextLevel = user.level * 200;
  const xpInCurrentLevel = user.xp - (user.level - 1) * 200;
  const progressPercent = Math.min(
    Math.round((xpInCurrentLevel / 200) * 100),
    100
  );
  const xpRemaining = xpForNextLevel - user.xp;

  const isTeacher = user.role === "teacher";
  const recentActivity = isTeacher ? CLASS_ACTIVITY : STUDENT_ACTIVITY;

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
            Level {user.level} Explorer
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
            {formatXP(user.xp)}
          </span>
          <span className="ml-1 text-sm text-muted-foreground">XP</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {xpRemaining > 0
            ? `${xpRemaining} XP remaining to Level ${user.level + 1}`
            : "Max level reached"}
        </p>

        <Progress
          value={progressPercent}
          className="mt-3 h-1.5"
          indicatorClassName="bg-xp"
        />

        <div className="mt-3 flex items-center gap-2 text-xs">
          <Flame className="h-3.5 w-3.5 text-orange-400" />
          <span className="font-medium">6-day streak</span>
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
          {DOMAIN_MASTERY.map((d) => (
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
