"use client";

import { useState } from "react";
import { RotateCcw, ThumbsUp, ThumbsDown, Minus } from "lucide-react";

interface FlashcardActivityProps {
  claimTitle: string;
  content: string;
  onRate: (outcome: "understood" | "did_not_understand" | "neutral") => void;
}

export function FlashcardActivity({
  claimTitle,
  content,
  onRate,
}: FlashcardActivityProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {/* Card */}
      <button
        onClick={() => setFlipped(!flipped)}
        className="group relative w-full cursor-pointer"
      >
        <div
          className={`rounded-xl border-2 bg-card px-8 py-12 text-center transition-all duration-300 ${
            flipped
              ? "border-primary/20 bg-primary/[0.02]"
              : "border-border hover:border-primary/30"
          }`}
        >
          {!flipped ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Question
              </p>
              <p className="mt-4 text-lg font-medium leading-relaxed">
                {claimTitle}
              </p>
              <p className="mt-6 text-xs text-muted-foreground">
                Click to reveal answer
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-widest text-primary">
                Answer
              </p>
              <p className="mt-4 text-sm leading-relaxed text-foreground/80">
                {content}
              </p>
            </>
          )}
        </div>
      </button>

      {/* Rating buttons — visible after flip */}
      {flipped && (
        <div className="flex items-center justify-center gap-3">
          <p className="mr-2 text-xs text-muted-foreground">How well did you know this?</p>
          <button
            onClick={() => onRate("did_not_understand")}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
            Didn&apos;t know
          </button>
          <button
            onClick={() => onRate("neutral")}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            <Minus className="h-3.5 w-3.5" />
            Partial
          </button>
          <button
            onClick={() => onRate("understood")}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-emerald-600 transition-colors hover:bg-emerald-50"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            Knew it
          </button>
        </div>
      )}

      {/* Reset */}
      {flipped && (
        <div className="text-center">
          <button
            onClick={() => setFlipped(false)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Flip back
          </button>
        </div>
      )}
    </div>
  );
}
