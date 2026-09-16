"use client";

import { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";

interface TrueFalseActivityProps {
  statement: string;
  correctAnswer: boolean;
  explanation: string;
  onSubmit: (answer: boolean) => Promise<void>;
  isLoading?: boolean;
}

export function TrueFalseActivity({
  statement,
  correctAnswer,
  explanation,
  onSubmit,
  isLoading,
}: TrueFalseActivityProps) {
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleAnswer = async (answer: boolean) => {
    if (submitted || isLoading) return;
    setAnswered(answer);
    setSubmitted(true);
    await onSubmit(answer);
  };

  const isCorrect = answered === correctAnswer;

  return (
    <div className="space-y-4">
      {/* Statement */}
      <div className="rounded-lg border bg-secondary/30 px-5 py-4">
        <p className="text-sm font-medium leading-relaxed">{statement}</p>
      </div>

      {/* True / False buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => handleAnswer(true)}
          disabled={submitted || isLoading}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
            submitted && answered === true
              ? isCorrect
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-red-400 bg-red-50 text-red-700"
              : submitted
                ? "border-border opacity-40"
                : "border-border hover:border-emerald-300 hover:bg-emerald-50/50"
          }`}
        >
          <Check className="h-4 w-4" />
          True
        </button>
        <button
          onClick={() => handleAnswer(false)}
          disabled={submitted || isLoading}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
            submitted && answered === false
              ? isCorrect
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-red-400 bg-red-50 text-red-700"
              : submitted
                ? "border-border opacity-40"
                : "border-border hover:border-red-300 hover:bg-red-50/50"
          }`}
        >
          <X className="h-4 w-4" />
          False
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Evaluating...
        </div>
      )}

      {/* Explanation shown after answering */}
      {submitted && !isLoading && (
        <div
          className={`rounded-md border p-4 ${
            isCorrect
              ? "border-emerald-200 bg-emerald-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <p className="text-sm font-semibold">
            {isCorrect ? "Correct!" : "Incorrect."}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">
            {explanation}
          </p>
        </div>
      )}
    </div>
  );
}
