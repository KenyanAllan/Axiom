"use client";

import { BookA } from "lucide-react";

interface GlossaryInlineCardProps {
  terms: Array<{
    id: number;
    term: string;
    definition: string;
  }>;
  onNavigateToGlossary: () => void;
}

export function GlossaryInlineCard({
  terms,
  onNavigateToGlossary,
}: GlossaryInlineCardProps) {
  if (!terms || terms.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {terms.map((t) => (
        <div
          key={t.id}
          className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
        >
          <div className="flex items-center gap-1.5">
            <BookA className="h-3 w-3 text-primary" />
            <span className="text-xs font-semibold">{t.term}</span>
          </div>
          <p className="mt-0.5 text-xs text-foreground/70 line-clamp-2">
            {t.definition}
          </p>
          <button
            onClick={onNavigateToGlossary}
            className="mt-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            View in Glossary &rarr;
          </button>
        </div>
      ))}
    </div>
  );
}
