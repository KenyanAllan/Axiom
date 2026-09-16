"use client";

import { ChevronRight, Boxes, Users } from "lucide-react";

interface QueuedCardProps {
  title: string;
  subtitle: string;
  xpReward: number;
  type: "sandbox" | "feynman" | "micro_project";
}

const TYPE_ICONS = {
  sandbox: <Boxes className="h-5 w-5 text-muted-foreground" />,
  feynman: <Users className="h-5 w-5 text-muted-foreground" />,
  micro_project: <Boxes className="h-5 w-5 text-muted-foreground" />,
};

export function QueuedCard({ title, subtitle, xpReward, type }: QueuedCardProps) {
  return (
    <button className="flex w-full items-center gap-4 rounded-lg border bg-card px-5 py-4 text-left transition-colors hover:bg-accent/50">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
        {TYPE_ICONS[type]}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{title}</p>
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Queued
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {subtitle}
        </p>
      </div>

      <span className="shrink-0 font-mono text-xs font-semibold text-xp">
        +{xpReward} XP
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
