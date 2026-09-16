"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";

interface ShortAnswerActivityProps {
  question: string;
  placeholder?: string;
  onSubmit: (response: string) => Promise<void>;
  feedback?: { outcome: string; feedback: string } | null;
  isLoading?: boolean;
}

export function ShortAnswerActivity({
  question,
  placeholder = "Type your answer...",
  onSubmit,
  feedback,
  isLoading,
}: ShortAnswerActivityProps) {
  const [response, setResponse] = useState("");

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    await onSubmit(response);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium leading-relaxed">{question}</p>

      {!feedback ? (
        <>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder={placeholder}
            rows={4}
            disabled={isLoading}
            className="w-full resize-none rounded-lg border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
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
              ? "Correct!"
              : feedback.outcome === "did_not_understand"
                ? "Not quite."
                : "Partially correct."}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">
            {feedback.feedback}
          </p>
        </div>
      )}
    </div>
  );
}
