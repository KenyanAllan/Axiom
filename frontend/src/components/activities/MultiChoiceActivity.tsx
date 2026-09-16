"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Send, Loader2 } from "lucide-react";

interface Option {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface MultiChoiceActivityProps {
  question: string;
  options: Option[];
  onSubmit: (selectedId: string) => Promise<void>;
  isLoading?: boolean;
}

export function MultiChoiceActivity({
  question,
  options,
  onSubmit,
  isLoading,
}: MultiChoiceActivityProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!selected || isLoading) return;
    setSubmitted(true);
    await onSubmit(selected);
  };

  const getOptionStyle = (opt: Option) => {
    if (!submitted) {
      return selected === opt.id
        ? "border-primary bg-primary/5 ring-1 ring-primary"
        : "border-border hover:border-primary/30 hover:bg-accent/30";
    }
    // After submission
    if (opt.isCorrect) return "border-emerald-400 bg-emerald-50";
    if (selected === opt.id && !opt.isCorrect) return "border-red-400 bg-red-50";
    return "border-border opacity-50";
  };

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium leading-relaxed">{question}</p>

      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => !submitted && setSelected(opt.id)}
            disabled={submitted}
            className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all ${getOptionStyle(opt)}`}
          >
            {/* Selection indicator */}
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                selected === opt.id
                  ? "border-primary bg-primary"
                  : "border-border"
              }`}
            >
              {selected === opt.id && (
                <span className="h-2 w-2 rounded-full bg-white" />
              )}
            </span>

            <span className="flex-1">{opt.text}</span>

            {/* Result icon */}
            {submitted && opt.isCorrect && (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            )}
            {submitted && selected === opt.id && !opt.isCorrect && (
              <XCircle className="h-4 w-4 shrink-0 text-red-600" />
            )}
          </button>
        ))}
      </div>

      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={!selected || isLoading}
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
      )}
    </div>
  );
}
