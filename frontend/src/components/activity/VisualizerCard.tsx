"use client";

import { Sparkles, ArrowRight } from "lucide-react";

export function VisualizerCard() {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            Subspace Transformation Geometry
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          det(A) &ne; 0
        </span>
      </div>

      {/* Placeholder for geometric visualization */}
      <div className="relative mx-5 my-4 flex h-44 items-center justify-center rounded-md bg-gradient-to-br from-slate-50 to-blue-50 border border-dashed border-border">
        {/* SVG coordinate visualization */}
        <svg viewBox="0 0 300 180" className="h-full w-auto">
          {/* Grid lines */}
          <line x1="150" y1="10" x2="150" y2="170" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
          <line x1="20" y1="90" x2="280" y2="90" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />

          {/* Original vectors (dashed) */}
          <line x1="150" y1="90" x2="220" y2="140" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="6 3" />
          <line x1="150" y1="90" x2="100" y2="40" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="6 3" />

          {/* Transformed vectors */}
          <line x1="150" y1="90" x2="240" y2="50" stroke="#3b82f6" strokeWidth="2" />
          <circle cx="240" cy="50" r="4" fill="#3b82f6" />
          <text x="248" y="48" fontSize="11" fill="#3b82f6" fontFamily="monospace">T(v&#x2081;)</text>

          <line x1="150" y1="90" x2="190" y2="35" stroke="#3b82f6" strokeWidth="2" />
          <circle cx="190" cy="35" r="4" fill="#3b82f6" />
          <text x="175" y="27" fontSize="11" fill="#3b82f6" fontFamily="monospace">T(v&#x2082;)</text>

          {/* Span region (light fill) */}
          <polygon points="150,90 240,50 190,35" fill="#3b82f6" opacity="0.08" />

          {/* Origin label */}
          <text x="155" y="106" fontSize="10" fill="#94a3b8" fontFamily="monospace">span(V)</text>
        </svg>
      </div>

      <div className="flex items-center justify-between border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">
          Interactive geometric verification
        </span>
        <button className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80">
          Launch 3D Visualizer
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
