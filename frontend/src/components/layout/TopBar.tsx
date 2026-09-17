"use client";

export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center border-b bg-background px-4">
      {/* Brand only */}
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
          Ax
        </div>
        <span className="font-mono text-sm font-semibold tracking-tight">
          Axiom
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          / v0.1.0 :: main :: workbench-active
        </span>
      </div>
    </header>
  );
}
