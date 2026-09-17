"use client";

import { Fragment, useState, useEffect } from "react";
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
  Loader2,
  History,
  MessageSquare,
  Bot,
  Filter,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  fetchTeacherClassrooms,
  fetchClassroomDetail,
  fetchClassroomDiagnostic,
  fetchStudentProgress,
  fetchClassroomActivityHistory,
} from "@/lib/api";
import type {
  ClassroomDetail,
  ClassroomDiagnosticResponse,
  StudentProgressResponse,
  ActivityHistoryItem,
} from "@/lib/api";
import type { CompletedActivityReview } from "@/components/activity/CompletedActivityReviewOverlay";

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

// ── Demo activity history ────────────────────────────────────────────────────

const DEMO_ACTIVITY_HISTORY: ActivityHistoryItem[] = [
  {
    id: 1,
    student_id: "usr_emma",
    student_name: "Emma Singh",
    activity_type: "flashcard",
    activity_title: "Flashcard: Row Echelon Form",
    claim_title: "Row Echelon Form",
    outcome: "understood",
    student_response: "A matrix is in row echelon form when all zero rows are at the bottom and each leading entry is to the right of the leading entry in the row above.",
    feedback: "Excellent! You've captured both key properties of REF.",
    xp_awarded: 25,
    attempted_at: "2026-09-16T15:20:00Z",
  },
  {
    id: 2,
    student_id: "usr_alice",
    student_name: "Alice Chen",
    activity_type: "quiz",
    activity_title: "Quiz: Gaussian Elimination Steps",
    claim_title: "Forward Elimination",
    outcome: "understood",
    student_response: JSON.stringify({
      0: 2,
      1: true,
      2: "Forward elimination systematically creates zeros below each pivot position using elementary row operations, transforming the augmented matrix into row echelon form.",
      3: 1,
    }),
    feedback: "4/4 correct",
    xp_awarded: 60,
    attempted_at: "2026-09-16T14:30:00Z",
    activity_payload: {
      questions: [
        {
          type: "multi_choice",
          question: "Which of the following is NOT an elementary row operation?",
          options: ["Swap two rows", "Multiply a row by a nonzero scalar", "Multiply two rows together", "Add a scalar multiple of one row to another"],
          correct_index: 2,
        },
        {
          type: "true_false",
          statement: "Forward elimination produces zeros below each pivot position.",
          correct_answer: true,
        },
        {
          type: "short_answer",
          prompt: "Describe what forward elimination achieves in Gaussian elimination.",
        },
        {
          type: "multi_choice",
          question: "If a 3×4 augmented matrix has pivots in columns 1, 2, and 3, the system has:",
          options: ["No solution", "Exactly one solution", "Infinitely many solutions", "Cannot be determined"],
          correct_index: 1,
        },
      ],
    },
  },
  {
    id: 8,
    student_id: "usr_bob",
    student_name: "Bob Martinez",
    activity_type: "quiz",
    activity_title: "Quiz: Row Reduction Fundamentals",
    claim_title: "Row Echelon Form",
    outcome: "did_not_understand",
    student_response: JSON.stringify({
      0: 0,
      1: false,
      2: ["zero", "left"],
    }),
    feedback: "1/3 correct",
    xp_awarded: 15,
    attempted_at: "2026-09-14T10:20:00Z",
    activity_payload: {
      questions: [
        {
          type: "multi_choice",
          question: "What does RREF stand for?",
          options: ["Reduced Row Echelon Form", "Row Reduced Elimination Form", "Reduced Row Elementary Form", "Row Reduction Echelon Format"],
          correct_index: 0,
        },
        {
          type: "true_false",
          statement: "Every matrix has a unique row echelon form.",
          correct_answer: false,
          explanation: "Row echelon form is NOT unique; however, the reduced row echelon form (RREF) IS unique.",
        },
        {
          type: "fill_blank",
          sentence: "A matrix is in REF when all ___ rows are at the bottom and each leading entry is to the ___ of the one above.",
          blanks: ["zero", "right"],
        },
      ],
    },
  },
  {
    id: 3,
    student_id: "usr_carol",
    student_name: "Carol Okonkwo",
    activity_type: "feynman",
    activity_title: "Feynman: Matrix Inverse",
    claim_title: "Inverse via Row Reduction",
    outcome: "understood",
    student_response: "To find the inverse, augment [A|I] and row reduce until you get [I|A⁻¹].",
    feedback: "Great explanation! You correctly described the augmented matrix method.",
    xp_awarded: 50,
    attempted_at: "2026-09-16T11:00:00Z",
  },
  {
    id: 4,
    student_id: "usr_bob",
    student_name: "Bob Martinez",
    activity_type: "flashcard",
    activity_title: "Flashcard: Partial Pivoting",
    claim_title: "Partial Pivoting",
    outcome: "did_not_understand",
    student_response: "Partial pivoting is when you swap columns.",
    feedback: "Not quite. Partial pivoting swaps rows (not columns) to place the largest absolute value in the pivot position, improving numerical stability.",
    xp_awarded: 10,
    attempted_at: "2026-09-12T09:15:00Z",
  },
  {
    id: 5,
    student_id: "usr_frank",
    student_name: "Frank Williams",
    activity_type: "scenario",
    activity_title: "Scenario: Network Flow",
    claim_title: "Kirchhoff's Current Law",
    outcome: "understood",
    student_response: "At each node, the sum of incoming currents equals the sum of outgoing currents, which gives us a system of linear equations.",
    feedback: "Excellent application of linear algebra to circuit analysis!",
    xp_awarded: 100,
    attempted_at: "2026-09-16T08:30:00Z",
  },
  {
    id: 6,
    student_id: "usr_david",
    student_name: "David Park",
    activity_type: "true_false",
    activity_title: "True/False: Determinants",
    claim_title: "Determinant Properties",
    outcome: "did_not_understand",
    student_response: "True — swapping two rows changes the sign of the determinant.",
    feedback: "The answer is correct, but you selected False on the quiz. Review the question carefully.",
    xp_awarded: 5,
    attempted_at: "2026-09-15T16:45:00Z",
  },
  {
    id: 7,
    student_id: "usr_emma",
    student_name: "Emma Singh",
    activity_type: "wrong_on_purpose",
    activity_title: "Wrong on Purpose: RREF Uniqueness",
    claim_title: "Uniqueness of RREF",
    outcome: "understood",
    student_response: "A matrix can have multiple different RREFs. (This is intentionally wrong — RREF is unique for any given matrix.)",
    feedback: "Perfect! You correctly identified and explained the deliberate error.",
    xp_awarded: 40,
    attempted_at: "2026-09-16T14:50:00Z",
  },
];

function historyItemToReview(item: ActivityHistoryItem): CompletedActivityReview {
  return {
    id: String(item.id),
    activityType: item.activity_type,
    activityTitle: item.activity_title,
    claimTitle: item.claim_title,
    topic: null,
    studentName: item.student_name,
    studentResponse: item.student_response,
    feedback: item.feedback,
    outcome: item.outcome,
    xpAwarded: item.xp_awarded,
    attemptedAt: item.attempted_at,
    payload: item.activity_payload ?? null,
  };
}

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

/** Convert backend progress responses into the component's StudentRow shape. */
function buildStudentRows(
  detail: ClassroomDetail,
  diagnostic: ClassroomDiagnosticResponse,
  progressMap: Record<string, StudentProgressResponse>
): StudentRow[] {
  const totalClaims = diagnostic.claim_ids.length || 1; // avoid /0

  return detail.students.map((s) => {
    const progress = progressMap[s.id];
    const masteryEntries = progress?.mastery ?? [];
    const claimsMastered = masteryEntries.filter(
      (m) => m.understanding_rating >= 4
    ).length;

    // Approximate topics: group mastered claims by topic-like grouping from diagnostic
    // Since we don't have per-topic info directly, estimate from mastery counts
    const topicsTotal = diagnostic.claim_ids.length > 0
      ? Math.max(1, Math.ceil(diagnostic.claim_ids.length / 3))
      : 8;
    const topicsMastered = Math.min(
      topicsTotal,
      Math.floor((claimsMastered / Math.max(totalClaims, 1)) * topicsTotal)
    );

    const history = progress?.activity_history ?? [];
    const latestAttempt = history[0]; // sorted desc from backend
    const recentOutcome: "understood" | "did_not_understand" | "neutral" =
      latestAttempt?.outcome === "understood"
        ? "understood"
        : latestAttempt?.outcome === "did_not_understand"
          ? "did_not_understand"
          : "neutral";

    const lastActive = latestAttempt?.attempted_at ?? s.joined_at;

    return {
      id: s.id,
      name: s.display_name,
      xp: progress?.xp ?? s.xp,
      level: progress?.level ?? s.level,
      streak: progress?.streak_days ?? 0,
      topicsMastered,
      topicsTotal,
      claimsMastered,
      claimsTotal: totalClaims,
      lastActive,
      recentOutcome,
    };
  });
}

/** Build topic breakdown from diagnostic mastery matrix. */
function buildTopicBreakdown(
  diagnostic: ClassroomDiagnosticResponse
): TopicBreakdown[] {
  // Group claims — we don't have topic names in the diagnostic response,
  // so we group claim_ids by prefix (e.g. "claim_ge_01" -> "ge").
  // If claim_ids are not prefixed, show one aggregate row.
  const claimsByGroup: Record<string, string[]> = {};
  for (const cid of diagnostic.claim_ids) {
    // Try to extract group from claim id pattern like "claim_XX_NN"
    const parts = cid.split("_");
    const group = parts.length >= 3 ? parts.slice(1, -1).join("_") : "all";
    if (!claimsByGroup[group]) claimsByGroup[group] = [];
    claimsByGroup[group].push(cid);
  }

  const studentCount = diagnostic.student_ids.length || 1;
  const result: TopicBreakdown[] = [];

  for (const [group, claimIds] of Object.entries(claimsByGroup)) {
    let totalRating = 0;
    let totalEntries = 0;

    for (const sid of diagnostic.student_ids) {
      const studentMastery = diagnostic.mastery_matrix[sid] ?? {};
      for (const cid of claimIds) {
        if (cid in studentMastery) {
          totalRating += studentMastery[cid];
          totalEntries++;
        }
      }
    }

    // understanding_rating is 1-5, normalize to 0-100%
    const avgRating = totalEntries > 0 ? totalRating / totalEntries : 0;
    const avgMastery = Math.round((avgRating / 5) * 100);

    // Count how many students have at least one mastery entry for this group
    let enrolled = 0;
    for (const sid of diagnostic.student_ids) {
      const studentMastery = diagnostic.mastery_matrix[sid] ?? {};
      if (claimIds.some((cid) => cid in studentMastery)) {
        enrolled++;
      }
    }

    // Prettify group name
    const name = group === "all"
      ? "All Topics"
      : group
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");

    result.push({ name, enrolled: enrolled || studentCount, avgMastery });
  }

  return result.sort((a, b) => b.avgMastery - a.avgMastery);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TeacherDashboardProps {
  userId?: string;
  onReviewActivity?: (review: CompletedActivityReview) => void;
}

export function TeacherDashboard({ userId, onReviewActivity }: TeacherDashboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);

  const [students, setStudents] = useState<StudentRow[]>(DEMO_STUDENTS);
  const [topics, setTopics] = useState<TopicBreakdown[]>(TOPIC_BREAKDOWN);
  const [activityHistory, setActivityHistory] = useState<ActivityHistoryItem[]>(DEMO_ACTIVITY_HISTORY);
  const [classroomTitle, setClassroomTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>("all");
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  // ── Fetch real data on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      try {
        // 1. Find the teacher's first classroom
        const classrooms = await fetchTeacherClassrooms(userId!);
        if (cancelled || classrooms.length === 0) {
          setLoading(false);
          return; // keep demo data
        }

        const classroom = classrooms[0];
        setClassroomTitle(classroom.title);

        // 2. Fetch detail + diagnostic in parallel
        const [detail, diagnostic] = await Promise.all([
          fetchClassroomDetail(userId!, classroom.id),
          fetchClassroomDiagnostic(userId!, classroom.id),
        ]);

        if (cancelled) return;

        if (detail.students.length === 0) {
          setLoading(false);
          return; // keep demo data
        }

        // 3. Fetch individual student progress (in parallel, max 20)
        const progressEntries = await Promise.all(
          detail.students.slice(0, 20).map(async (s) => {
            try {
              const progress = await fetchStudentProgress(
                userId!,
                classroom.id,
                s.id
              );
              return [s.id, progress] as const;
            } catch (err) {
              console.error("TeacherDashboard: failed to fetch student progress:", err);
              return [s.id, null] as const;
            }
          })
        );

        if (cancelled) return;

        const progressMap: Record<string, StudentProgressResponse> = {};
        for (const [sid, prog] of progressEntries) {
          if (prog) progressMap[sid] = prog;
        }

        // 4. Build display data
        const rows = buildStudentRows(detail, diagnostic, progressMap);
        if (rows.length > 0) setStudents(rows);

        const topicRows = buildTopicBreakdown(diagnostic);
        if (topicRows.length > 0) setTopics(topicRows);

        // 5. Fetch classroom-wide activity history
        try {
          const history = await fetchClassroomActivityHistory(userId!, classroom.id);
          if (!cancelled && history.items.length > 0) {
            setActivityHistory(history.items);
          }
        } catch (err) {
          console.error("TeacherDashboard: failed to fetch activity history:", err);
        }
      } catch (err) {
        console.warn("TeacherDashboard: API unavailable, using demo data", err);
        // keep demo data on any error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ── Sort / aggregate ────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sorted = [...students].sort((a, b) => {
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
  const totalStudents = students.length;
  const avgXP = Math.round(students.reduce((s, st) => s + st.xp, 0) / (totalStudents || 1));
  const totalClaimsMastered = students.reduce((s, st) => s + st.claimsMastered, 0);
  const totalClaimsAll = students.reduce((s, st) => s + st.claimsTotal, 0);
  const avgMastery = totalClaimsAll > 0
    ? Math.round((totalClaimsMastered / totalClaimsAll) * 100)
    : 0;

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc ? (
      <ChevronUp className="ml-0.5 inline h-3 w-3" />
    ) : (
      <ChevronDown className="ml-0.5 inline h-3 w-3" />
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center px-6 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading classroom data...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-6 py-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold">Classroom Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          {classroomTitle ?? "Applied Linear Algebra"} — Fall 2026
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
          {topics.map((topic) => (
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

      {/* Activity History */}
      <div id="activity-history" className="rounded-lg border">
        <div className="border-b bg-secondary/30 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Activity History</h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {activityHistory.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Filter className="h-3 w-3 text-muted-foreground" />
              <select
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                className="rounded border bg-background px-2 py-1 text-xs"
              >
                <option value="all">All Outcomes</option>
                <option value="understood">Understood</option>
                <option value="did_not_understand">Needs Review</option>
              </select>
            </div>
          </div>
        </div>
        <div className="divide-y">
          {activityHistory
            .filter((item) =>
              historyFilter === "all" ? true : item.outcome === historyFilter
            )
            .map((item) => (
              <ActivityHistoryRow
                key={item.id}
                item={item}
                isExpanded={expandedHistoryId === item.id}
                onToggle={() => {
                  if (onReviewActivity) {
                    onReviewActivity(historyItemToReview(item));
                  } else {
                    setExpandedHistoryId(
                      expandedHistoryId === item.id ? null : item.id
                    );
                  }
                }}
              />
            ))}
          {activityHistory.filter((item) =>
            historyFilter === "all" ? true : item.outcome === historyFilter
          ).length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No activity matches this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActivityHistoryRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: ActivityHistoryItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const typeLabel: Record<string, string> = {
    flashcard: "Flashcard",
    quiz: "Quiz",
    feynman: "Feynman",
    scenario: "Scenario",
    true_false: "True/False",
    fill_blank: "Fill Blank",
    short_answer: "Short Answer",
    wrong_on_purpose: "Wrong on Purpose",
    multi_choice: "Multiple Choice",
    mini_podcast: "Mini Podcast",
    flashcard_deck: "Flashcard Deck",
  };

  const typeColors: Record<string, string> = {
    flashcard: "bg-blue-100 text-blue-700",
    quiz: "bg-purple-100 text-purple-700",
    feynman: "bg-amber-100 text-amber-700",
    scenario: "bg-emerald-100 text-emerald-700",
    true_false: "bg-cyan-100 text-cyan-700",
    wrong_on_purpose: "bg-rose-100 text-rose-700",
  };

  const hasDetail = item.student_response || item.feedback;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
          {item.student_name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{item.student_name}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                typeColors[item.activity_type] ?? "bg-secondary text-muted-foreground"
              }`}
            >
              {typeLabel[item.activity_type] ?? item.activity_type}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.activity_title}
            {item.claim_title && ` — ${item.claim_title}`}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <OutcomeBadge outcome={item.outcome as "understood" | "did_not_understand" | "neutral"} />
            <span className="font-mono text-xp">+{item.xp_awarded} XP</span>
            <span className="text-muted-foreground">
              {item.attempted_at ? timeAgo(item.attempted_at) : "—"}
            </span>
          </div>
        </div>
        {hasDetail && (
          <div className="mt-2 shrink-0 text-muted-foreground">
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </div>
        )}
      </button>
      {isExpanded && hasDetail && (
        <div className="mx-4 mb-3 ml-[60px] space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
          {item.student_response && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                <span className="font-mono text-[10px] font-semibold uppercase">
                  Student Response
                </span>
              </div>
              <p className="text-xs leading-relaxed">{item.student_response}</p>
            </div>
          )}
          {item.feedback && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                <Bot className="h-3 w-3" />
                <span className="font-mono text-[10px] font-semibold uppercase">
                  AI Feedback
                </span>
              </div>
              <p className="text-xs leading-relaxed">{item.feedback}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
