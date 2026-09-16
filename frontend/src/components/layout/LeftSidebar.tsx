"use client";

import {
  BookOpen,
  Code2,
  FlaskConical,
  GitBranch,
  LogOut,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import type { UserProfile } from "@/lib/types";

interface LeftSidebarProps {
  user: UserProfile;
  onLogout: () => void;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}

const WORKBENCH_ITEMS: NavItem[] = [
  { label: "Kata Challenges", icon: <BookOpen className="h-4 w-4" />, active: true },
  { label: "System Architecture", icon: <GitBranch className="h-4 w-4" /> },
  { label: "Syntax Lab", icon: <FlaskConical className="h-4 w-4" /> },
  { label: "Algorithms Vault", icon: <Code2 className="h-4 w-4" /> },
];


export function LeftSidebar({ user, onLogout }: LeftSidebarProps) {
  const initials = user.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const isStudent = user.role === "student";

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r bg-background">
      {/* User profile — moved here from NavPanel */}
      <div className="px-3 py-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 border-2 border-border">
              <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-semibold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -right-0.5 bottom-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.display_name}</p>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-primary">
              {user.role}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              Lvl {user.level}
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Workbench nav */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Axiom Workbench
        </p>
        <nav className="mb-6 space-y-0.5">
          {WORKBENCH_ITEMS.map((item) => (
            <button
              key={item.label}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                item.active
                  ? "border-l-2 border-primary bg-primary/5 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

      </div>

      <Separator />

      {/* Bottom: sync status + logout */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span>Sync Engine</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-emerald-600">Connected</span>
          </span>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/60">
          env: axiom-workspace
        </p>
      </div>

      <button
        onClick={onLogout}
        className="flex items-center gap-2.5 border-t px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </button>
    </aside>
  );
}
