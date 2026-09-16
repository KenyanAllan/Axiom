"use client";

import { useState } from "react";
import { Send, Loader2, Lightbulb } from "lucide-react";

interface FeynmanActivityProps {
  claimTitle: string;
  content: string;
  onSubmit: (explanation: string) => Promise<void>;
  feedback?: { outcome: string; feedback: string } | null;
  isLoading?: boolean;
}

export function FeynmanActivity({
  claimTitle,
  content,
  onSubmit,
  feedback,
  isLoading,
}: FeynmanActivityProps) {
  const [explanation, setExplanation] = useState("");

  const handleSubmit = async () => {
    if (!explanation.trim() || isLoading) return;
    await onSubmit(explanation);
  };

  return (
    <div className="space-y-4">
      {/* Prompt */}
      <div className="rounded-lg border bg-amber-50/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold">Feynman Technique</p>
            <p className="mt-1 text-sm text-foreground/80">
              Explain the following concept in your own words as if teaching
              someone who has never encountered it. Use simple language and
              concrete examples.
            </p>
          </div>
        </div>
      </div>

      {/* Concept to explain */}
      <div className="rounded-lg border bg-secondary/30 px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Concept
        </p>
        <p className="mt-2 text-sm font-semibold">{claimTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground/80">
          {content}
        </p>
      </div>

      {/* Explanation input */}
      {!feedback ? (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Your explanation
            </label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="In simple terms, this concept means..."
              rows={6}
              disabled={isLoading}
              className="w-full resize-none rounded-lg border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Aim for clarity over completeness. Use analogies if they help.
            </p>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!explanation.trim() || isLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Submit Explanation
                <Send className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </>
      ) : (
        <div
          className={`rounded-md border p-4 ${
            feedback.outcome === "understood"
              ? "border-emerald-200 bg-emerald-50"
              : feedback.outcome === "did_not_understand"
                ? "border-red-200 bg-red-50"
                : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className="text-sm font-semibold">
            {feedback.outcome === "understood"
              ? "Great explanation!"
              : feedback.outcome === "did_not_understand"
                ? "Needs more work."
                : "Good start, but could be clearer."}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">
            {feedback.feedback}
          </p>
        </div>
      )}
    </div>
  );
}
