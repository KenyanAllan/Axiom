"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  HelpCircle,
  Loader2,
  Send,
} from "lucide-react";

interface DiagnosticCardProps {
  claimId: string;
  claimTitle: string;
  topicTitle: string;
  diagnosticPrompt: string | null;
  flawedSnippet: string | null;
  xpReward: number;
  level?: number;
  onSubmit: (claimId: string, response: string) => Promise<void>;
  feedback?: { is_correct: boolean; feedback: string } | null;
  isLoading?: boolean;
}

export function DiagnosticCard({
  claimId,
  claimTitle,
  topicTitle,
  diagnosticPrompt,
  flawedSnippet,
  xpReward,
  level = 2,
  onSubmit,
  feedback,
  isLoading,
}: DiagnosticCardProps) {
  const [response, setResponse] = useState("");

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    await onSubmit(claimId, response);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header badge */}
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="rounded bg-amber-50 px-2 py-0.5 font-mono text-xs font-semibold text-amber-700">
            Level {level} Diagnostic
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            #{claimId}
          </span>
        </div>
        <span className="font-mono text-xs font-semibold text-xp">
          +{xpReward} XP
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* Agent hypothesis block */}
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm">
              <span className="font-semibold">Peer Agent Delta</span>
              <span className="ml-2 text-xs text-muted-foreground">
                Autoregressive Co-Pilot
              </span>
            </p>
            <p className="mt-1 text-sm italic text-foreground/80 leading-relaxed">
              &ldquo;{claimTitle}&rdquo;
            </p>
          </div>
        </div>

        {/* Flawed code snippet */}
        {flawedSnippet && (
          <div className="code-block">
            <div className="filename">
              <span className="flex items-center gap-1.5">
                <span className="font-mono">[] diagnostic_test.py</span>
              </span>
              <span>Python 3.11</span>
            </div>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {flawedSnippet}
            </pre>
          </div>
        )}

        {/* Prompt */}
        {diagnosticPrompt && (
          <div className="flex items-start gap-2 text-sm text-foreground/80">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>{diagnosticPrompt}</p>
          </div>
        )}

        {/* Input + submit */}
        {!feedback ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Type counter-argument or formal flaw (e.g., symme..."
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading}
            />
            <button
              onClick={handleSubmit}
              disabled={!response.trim() || isLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Submit
                  <Send className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        ) : (
          /* Feedback result */
          <div
            className={`rounded-md border p-4 ${
              feedback.is_correct
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p className="text-sm font-semibold">
              {feedback.is_correct ? "Correct!" : "Not quite."}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/80">
              {feedback.feedback}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
