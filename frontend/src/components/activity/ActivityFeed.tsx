"use client";

import { useState, useCallback } from "react";
import { DiagnosticCard } from "./DiagnosticCard";
import { QueuedCard } from "./QueuedCard";
import { VisualizerCard } from "./VisualizerCard";

// ── Demo data (replaced by TanStack Query + API in production) ──────────────

const DEMO_DIAGNOSTIC = {
  claimId: "claim_rr_01",
  claimTitle:
    "I hypothesize that multiplying matrix A by its transpose Aᵀ will always produce an identity matrix if A is symmetric.",
  topicTitle: "Row Reduction & Echelon Forms",
  diagnosticPrompt:
    "Identify the false premise in Agent Delta's reasoning.",
  flawedSnippet: `# Validate hypothesis with counterexample
assert (A @ A.T == np.eye(n)).all(), "Counterexample:
A = [[2, 1], [1, 2]]"`,
  xpReward: 75,
};

const DEMO_QUEUED = [
  {
    title: "Matrix Inversion Sandbox",
    subtitle: "Gaussian Elimination & Row Operations",
    xpReward: 100,
    type: "sandbox" as const,
  },
  {
    title: "Feynman Diagnostic: Atomic Claim [...]",
    subtitle: "Explain why elementary row operations do not alt...",
    xpReward: 50,
    type: "feynman" as const,
  },
];

export function ActivityFeed() {
  const [feedback, setFeedback] = useState<{
    is_correct: boolean;
    feedback: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = useCallback(async (claimId: string, response: string) => {
    setIsLoading(true);
    try {
      // In production this calls evaluateResponse() from @/lib/api
      // For demo, simulate a short delay and return mock feedback
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
        setFeedback({
          is_correct: data.is_correct,
          feedback: data.feedback,
        });
      } else {
        // Offline fallback — simulate grading
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
  }, []);

  return (
    <div className="space-y-4 px-6 py-5">
      {/* Primary diagnostic card */}
      <DiagnosticCard
        claimId={DEMO_DIAGNOSTIC.claimId}
        claimTitle={DEMO_DIAGNOSTIC.claimTitle}
        topicTitle={DEMO_DIAGNOSTIC.topicTitle}
        diagnosticPrompt={DEMO_DIAGNOSTIC.diagnosticPrompt}
        flawedSnippet={DEMO_DIAGNOSTIC.flawedSnippet}
        xpReward={DEMO_DIAGNOSTIC.xpReward}
        onSubmit={handleSubmit}
        feedback={feedback}
        isLoading={isLoading}
      />

      {/* Queued activity cards */}
      {DEMO_QUEUED.map((q) => (
        <QueuedCard key={q.title} {...q} />
      ))}

      {/* Visualizer card */}
      <VisualizerCard />
    </div>
  );
}
