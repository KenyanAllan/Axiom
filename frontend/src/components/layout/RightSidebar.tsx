"use client";

import { Flame, Trophy } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { UserProfile } from "@/lib/types";
import { formatXP } from "@/lib/utils";

interface RightSidebarProps {
  user: UserProfile;
  onActivityClick?: (activityId: string) => void;
}

const DOMAIN_MASTERY = [
  { domain: "Linear Algebra", percent: 78 },
  { domain: "Data Structures", percent: 45 },
  { domain: "Discrete Math", percent: 92 },
];

const STUDENT_ACTIVITY = [
  {
    color: "bg-blue-500",
    title: "Completed Flashcard: Row Invariance",
    xp: 15,
    time: "10m ago",
    activityId: "diag_1",
  },
  {
    color: "bg-blue-600",
    title: "Passed Micro-Project: Partial Pivot Unit Tests",
    xp: 120,
    time: "1h ago",
    activityId: "queued_1",
  },
  {
    color: "bg-gray-400",
    title: "Mastered [claim_ge_01]",
    xp: 50,
    time: "Yesterday",
    activityId: "queued_2",
  },
];

const CLASS_ACTIVITY = [
  {
    color: "bg-blue-500",
    title: "Alex K. completed Row Invariance Diagnostic",
    xp: 15,
    time: "10m ago",
    activityId: "diag_1",
  },
  {
    color: "bg-purple-500",
    title: "Maya R. started Feynman: Elementary Row Ops",
    xp: 50,
    time: "25m ago",
    activityId: "queued_2",
  },
  {
    color: "bg-blue-600",
    title: "Jordan L. completed Matrix Inversion Sandbox",
    xp: 100,
    time: "1h ago",
    activityId: "queued_1",
  },
  {
    color: "bg-emerald-500",
    title: "Sam T. mastered Gaussian Elimination",
    xp: 75,
    time: "2h ago",
    activityId: "diag_1",
  },
];

export function RightSidebar({ user, onActivityClick }: RightSidebarProps) {
  const xpForNextLevel = user.level * 200;
  const xpInCurrentLevel = user.xp - (user.level - 1) * 200;
  const progressPercent = Math.min(
    Math.round((xpInCurrentLevel / 200) * 100),
    100
  );
  const xpRemaining = xpForNextLevel - user.xp;

  const isTeacher = user.role === "teacher";
  const recentActivity = isTeacher ? CLASS_ACTIVITY : STUDENT_ACTIVITY;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l bg-background">
      {/* XP / Level block */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Level {user.level} Explorer
          </p>
          <Trophy className="h-4 w-4 text-primary" />
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
