"use client";

import { useState, useCallback } from "react";
import {
  AlertTriangle,
  Boxes,
  Users,
  ChevronRight,
  X,
} from "lucide-react";
import { DiagnosticCard } from "./DiagnosticCard";

export interface Activity {
  id: string;
  type: "diagnostic" | "sandbox" | "feynman";
  title: string;
  topic: string;
  xp: number;
  claimId?: string;
  claimTitle?: string;
  diagnosticPrompt?: string;
  flawedSnippet?: string;
  description?: string;
}

export const DEMO_ACTIVITIES: Activity[] = [
  {
    id: "diag_1",
    type: "diagnostic",
    title: "Identify the false premise in Agent Delta's reasoning",
    topic: "Row Reduction & Echelon Forms",
    xp: 75,
    claimId: "claim_rr_01",
    claimTitle:
      "I hypothesize that multiplying matrix A by its transpose Aᵀ will always produce an identity matrix if A is symmetric.",
    diagnosticPrompt:
      "Identify the false premise in Agent Delta's reasoning.",
    flawedSnippet: `# Validate hypothesis with counterexample
assert (A @ A.T == np.eye(n)).all(), "Counterexample:
A = [[2, 1], [1, 2]]"`,
  },
  {
    id: "queued_1",
    type: "sandbox",
    title: "Matrix Inversion Sandbox",
    topic: "Gaussian Elimination & Row Operations",
    xp: 100,
    description:
      "Practice computing matrix inverses step-by-step using row reduction. You'll be given a matrix and need to augment it with the identity matrix, then reduce to find the inverse.",
  },
  {
    id: "queued_2",
    type: "feynman",
    title: "Feynman Diagnostic: Elementary Row Operations",
    topic: "Row Reduction & Echelon Forms",
    xp: 50,
    description:
      "Explain in your own words why elementary row operations do not change the solution set of a system of linear equations. The Feynman technique tests true understanding — if you can teach it simply, you understand it.",
  },
];

export const TYPE_CONFIG = {
  diagnostic: {
    label: "Diagnostic",
    icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-50",
  },
  sandbox: {
    label: "Sandbox",
    icon: Boxes,
    color: "text-blue-500",
    bg: "bg-blue-50",
  },
  feynman: {
    label: "Feynman",
    icon: Users,
    color: "text-purple-500",
    bg: "bg-purple-50",
  },
};

// ── Collapsed list view ───────────────────────────────────────────────────────

interface ActivityFeedProps {
  onExpandActivity: (id: string) => void;
}

export function ActivityFeed({ onExpandActivity }: ActivityFeedProps) {
  return (
    <div className="space-y-2 px-6 py-5">
      <h2 className="text-lg font-bold">Activity Feed</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Your pending learning activities. Click to expand.
      </p>
      {DEMO_ACTIVITIES.map((activity) => {
        const config = TYPE_CONFIG[activity.type];
        const Icon = config.icon;
        return (
          <button
            key={activity.id}
            onClick={() => onExpandActivity(activity.id)}
            className="flex w-full items-center gap-4 rounded-lg border bg-card px-5 py-4 text-left transition-all hover:bg-accent/30 hover:shadow-sm"
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${config.bg}`}
            >
              <Icon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {activity.title}
                </p>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${config.bg} ${config.color}`}
                >
                  {config.label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {activity.topic}
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs font-semibold text-xp">
              +{activity.xp} XP
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

// ── Fullscreen overlay ────────────────────────────────────────────────────────

interface ActivityOverlayProps {
  activityId: string;
  onClose: () => void;
}

export function ActivityOverlay({ activityId, onClose }: ActivityOverlayProps) {
  const [feedback, setFeedback] = useState<{
    is_correct: boolean;
    feedback: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const activity = DEMO_ACTIVITIES.find((a) => a.id === activityId);
  if (!activity) return null;
  const config = TYPE_CONFIG[activity.type];

  const handleSubmit = async (claimId: string, response: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/activities/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Demo-User": "usr_student_demo",
        },
        body: JSON.stringify({
          claim_id: claimId,
          student_response: response,
        }),
      }).catch(() => null);

      if (res?.ok) {
        const data = await res.json();
        setFeedback({ is_correct: data.is_correct, feedback: data.feedback });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        const isCorrect = response.length > 30;
        setFeedback({
          is_correct: isCorrect,
          feedback: isCorrect
            ? "Good catch. AAᵀ = I only when A is orthogonal, not merely symmetric. The matrix [[2,1],[1,2]] is symmetric but AAᵀ = [[5,4],[4,5]] ≠ I."
            : "Not quite. Think about what property A must have for AAᵀ = I to hold. Symmetry alone is not sufficient — consider a specific counterexample.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {activity.type === "diagnostic" ? (
          <DiagnosticCard
            claimId={activity.claimId!}
            claimTitle={activity.claimTitle!}
            topicTitle={activity.topic}
            diagnosticPrompt={activity.diagnosticPrompt!}
            flawedSnippet={activity.flawedSnippet!}
            xpReward={activity.xp}
            onSubmit={handleSubmit}
            feedback={feedback}
            isLoading={isLoading}
          />
        ) : (
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div className="flex items-center gap-2">
                <config.icon className={`h-4 w-4 ${config.color}`} />
                <span
                  className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${config.bg} ${config.color}`}
                >
                  {config.label}
                </span>
              </div>
              <span className="font-mono text-xs font-semibold text-xp">
                +{activity.xp} XP
              </span>
            </div>
            <div className="space-y-4 px-5 py-5">
              <h3 className="text-lg font-semibold">{activity.title}</h3>
              <p className="text-sm text-muted-foreground">{activity.topic}</p>
              {activity.description && (
                <p className="text-sm leading-relaxed text-foreground/80">
                  {activity.description}
                </p>
              )}
              <div className="rounded-md border bg-secondary/30 px-4 py-3">
                <p className="text-sm italic text-muted-foreground">
                  This activity type will be fully interactive in production.
                  For now, this is a preview of the activity structure.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
