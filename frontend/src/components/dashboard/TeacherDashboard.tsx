"use client";

import { Fragment, useState } from "react";
import {
  Users,
  TrendingUp,
  Award,
  BookOpen,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  BarChart3,
  Target,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

// ── Demo student data ─────────────────────────────────────────────────────────

interface StudentRow {
  id: string;
  name: string;
  xp: number;
  level: number;
  streak: number;
  topicsMastered: number;
  topicsTotal: number;
  claimsMastered: number;
  claimsTotal: number;
  lastActive: string;
  recentOutcome: "understood" | "did_not_understand" | "neutral";
}

const DEMO_STUDENTS: StudentRow[] = [
  {
    id: "usr_alice",
    name: "Alice Chen",
    xp: 4200,
    level: 13,
    streak: 12,
    topicsMastered: 5,
    topicsTotal: 8,
    claimsMastered: 18,
    claimsTotal: 24,
    lastActive: "2026-09-16T14:30:00Z",
    recentOutcome: "understood",
  },
  {
    id: "usr_bob",
    name: "Bob Martinez",
    xp: 1850,
    level: 6,
    streak: 0,
    topicsMastered: 2,
    topicsTotal: 8,
    claimsMastered: 8,
    claimsTotal: 24,
    lastActive: "2026-09-12T09:15:00Z",
    recentOutcome: "did_not_understand",
  },
  {
    id: "usr_carol",
    name: "Carol Okonkwo",
    xp: 3650,
    level: 11,
    streak: 6,
    topicsMastered: 4,
    topicsTotal: 8,
    claimsMastered: 15,
    claimsTotal: 24,
    lastActive: "2026-09-16T11:00:00Z",
    recentOutcome: "understood",
  },
  {
    id: "usr_david",
    name: "David Park",
    xp: 920,
    level: 3,
    streak: 1,
    topicsMastered: 1,
    topicsTotal: 8,
    claimsMastered: 4,
    claimsTotal: 24,
    lastActive: "2026-09-15T16:45:00Z",
    recentOutcome: "neutral",
  },
  {
    id: "usr_emma",
    name: "Emma Singh",
    xp: 5100,
    level: 15,
    streak: 21,
    topicsMastered: 7,
    topicsTotal: 8,
    claimsMastered: 22,
    claimsTotal: 24,
    lastActive: "2026-09-16T15:20:00Z",
    recentOutcome: "understood",
  },
  {
    id: "usr_frank",
    name: "Frank Williams",
    xp: 2400,
    level: 8,
    streak: 3,
    topicsMastered: 3,
    topicsTotal: 8,
    claimsMastered: 11,
    claimsTotal: 24,
    lastActive: "2026-09-16T08:30:00Z",
    recentOutcome: "understood",
  },
];

// ── Topic breakdown data ──────────────────────────────────────────────────────

interface TopicBreakdown {
  name: string;
  enrolled: number;
  avgMastery: number;
}

const TOPIC_BREAKDOWN: TopicBreakdown[] = [
  { name: "Row Reduction & Echelon Forms", enrolled: 6, avgMastery: 72 },
  { name: "Gaussian Elimination", enrolled: 6, avgMastery: 58 },
  { name: "Matrix Inverses", enrolled: 5, avgMastery: 34 },
  { name: "Determinants", enrolled: 4, avgMastery: 45 },
  { name: "Vector Spaces", enrolled: 3, avgMastery: 22 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const hours = Math.floor((now.getTime() - d.getTime()) / 3600000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

type SortKey = "name" | "xp" | "mastery" | "lastActive" | "streak";

// ── Component ─────────────────────────────────────────────────────────────────

export function TeacherDashboard() {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sorted = [...DEMO_STUDENTS].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "xp":
        cmp = a.xp - b.xp;
        break;
      case "mastery":
        cmp = a.claimsMastered / a.claimsTotal - b.claimsMastered / b.claimsTotal;
        break;
      case "lastActive":
        cmp = new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime();
        break;
      case "streak":
        cmp = a.streak - b.streak;
        break;
    }
    return sortAsc ? cmp : -cmp;
  });

  // Aggregate stats
  const totalStudents = DEMO_STUDENTS.length;
  const avgXP = Math.round(DEMO_STUDENTS.reduce((s, st) => s + st.xp, 0) / totalStudents);
  const avgMastery = Math.round(
    (DEMO_STUDENTS.reduce((s, st) => s + st.claimsMastered, 0) /
      DEMO_STUDENTS.reduce((s, st) => s + st.claimsTotal, 0)) *
      100
  );

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc ? (
      <ChevronUp className="ml-0.5 inline h-3 w-3" />
    ) : (
      <ChevronDown className="ml-0.5 inline h-3 w-3" />
    );
  };

  return (
    <div className="space-y-6 px-6 py-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Classroom Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Applied Linear Algebra — Fall 2026
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={<Users className="h-4 w-4 text-primary" />}
          label="Students"
          value={totalStudents.toString()}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          label="Avg XP"
          value={avgXP.toLocaleString()}
        />
        <StatCard
          icon={<Target className="h-4 w-4 text-blue-500" />}
          label="Avg Mastery"
          value={`${avgMastery}%`}
        />
      </div>

      {/* Student table */}
      <div className="rounded-lg border">
        <div className="border-b bg-secondary/30 px-4 py-2.5">
          <h3 className="text-sm font-semibold">Student Progress</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/20">
                <th className="px-4 py-2.5 text-left font-medium">
                  <button onClick={() => handleSort("name")} className="hover:text-foreground">
                    Student <SortIcon col="name" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  <button onClick={() => handleSort("xp")} className="hover:text-foreground">
                    XP <SortIcon col="xp" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left font-medium">Level</th>
                <th className="px-4 py-2.5 text-left font-medium">
                  <button onClick={() => handleSort("mastery")} className="hover:text-foreground">
                    Mastery <SortIcon col="mastery" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  <button onClick={() => handleSort("streak")} className="hover:text-foreground">
                    Streak <SortIcon col="streak" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left font-medium">
                  <button onClick={() => handleSort("lastActive")} className="hover:text-foreground">
                    Last Active <SortIcon col="lastActive" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((student) => {
                const masteryPct = Math.round(
                  (student.claimsMastered / student.claimsTotal) * 100
                );
                const isExpanded = selectedStudent === student.id;

                return (
                  <Fragment key={student.id}>
                    <tr
                      onClick={() =>
                        setSelectedStudent(isExpanded ? null : student.id)
                      }
                      className={`cursor-pointer border-b transition-colors hover:bg-accent/30 ${
                        isExpanded ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                            {student.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <span className="font-medium">{student.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {student.xp.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">
                          {student.level}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                            <div
                              className={`h-full rounded-full transition-all ${
                                masteryPct >= 70
                                  ? "bg-emerald-500"
                                  : masteryPct >= 40
                                    ? "bg-blue-500"
                                    : "bg-amber-500"
                              }`}
                              style={{ width: `${masteryPct}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">
                            {masteryPct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {student.streak > 0 ? (
                          <span className="text-orange-500">{student.streak}d</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {timeAgo(student.lastActive)}
                      </td>
                      <td className="px-4 py-3">
                        <OutcomeBadge outcome={student.recentOutcome} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${student.id}-detail`}>
                        <td colSpan={7} className="border-b bg-secondary/10 px-6 py-4">
                          <StudentDetail student={student} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Topic breakdown */}
      <div className="rounded-lg border">
        <div className="border-b bg-secondary/30 px-4 py-2.5">
          <h3 className="text-sm font-semibold">Topic Breakdown</h3>
        </div>
        <div className="divide-y">
          {TOPIC_BREAKDOWN.map((topic) => (
            <div
              key={topic.name}
              className="flex items-center gap-4 px-4 py-3"
            >
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{topic.name}</p>
                <p className="text-xs text-muted-foreground">
                  {topic.enrolled} enrolled
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${
                        topic.avgMastery >= 70
                          ? "bg-emerald-500"
                          : topic.avgMastery >= 40
                            ? "bg-blue-500"
                            : "bg-amber-500"
                      }`}
                      style={{ width: `${topic.avgMastery}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-xs text-muted-foreground">
                    {topic.avgMastery}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        highlight ? "border-amber-200 bg-amber-50/50" : "bg-card"
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function OutcomeBadge({
  outcome,
}: {
  outcome: "understood" | "did_not_understand" | "neutral";
}) {
  switch (outcome) {
    case "understood":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3 w-3" />
          Good
        </span>
      );
    case "did_not_understand":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
          <Clock className="h-3 w-3" />
          Reviewing
        </span>
      );
    case "neutral":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Partial
        </span>
      );
  }
}

function StudentDetail({ student }: { student: StudentRow }) {
  const topicProgress = [
    { name: "Row Reduction", mastered: 3, total: 3 },
    { name: "Gaussian Elimination", mastered: 2, total: 3 },
    { name: "Matrix Inverses", mastered: 1, total: 3 },
    { name: "Determinants", mastered: 0, total: 3 },
  ];

  const recentAttempts = [
    { claim: "Forward elimination phase", outcome: "understood" as const, time: "2h ago" },
    { claim: "Partial pivoting", outcome: "did_not_understand" as const, time: "3h ago" },
    { claim: "Uniqueness of RREF", outcome: "understood" as const, time: "1d ago" },
  ];

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left: topic progress */}
      <div>
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Topic Progress
        </p>
        <div className="space-y-2">
          {topicProgress.map((t) => {
            const pct = Math.round((t.mastered / t.total) * 100);
            return (
              <div key={t.name} className="flex items-center gap-3">
                <span className="w-36 truncate text-xs">{t.name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full ${
                      pct === 100
                        ? "bg-emerald-500"
                        : pct > 0
                          ? "bg-blue-500"
                          : "bg-muted"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-[11px] text-muted-foreground">
                  {t.mastered}/{t.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: recent attempts */}
      <div>
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Recent Attempts
        </p>
        <div className="space-y-2">
          {recentAttempts.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {a.outcome === "understood" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : a.outcome === "did_not_understand" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">{a.claim}</span>
              <span className="text-muted-foreground">{a.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
