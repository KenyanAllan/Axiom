"use client";

import { useState } from "react";
import {
  BookOpen,
  Code2,
  FlaskConical,
  GitBranch,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
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
  const [collapsed, setCollapsed] = useState(false);

  const initials = user.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r bg-background transition-all duration-200 ${
        collapsed ? "w-[52px]" : "w-[220px]"
      }`}
    >
      {/* Brand + collapse toggle */}
      <div className={`flex items-center ${collapsed ? "justify-center px-0" : "justify-between px-4"} py-3`}>
        <div className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
            Ax
          </div>
          {!collapsed && (
            <span className="font-mono text-sm font-semibold tracking-tight">
              Axiom
            </span>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Collapse panel"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <Separator />

      {/* User profile */}
      <div className={collapsed ? "flex justify-center py-4" : "px-3 py-4"}>
        {collapsed ? (
          <div className="relative" title={`${user.display_name} — ${user.role}`}>
            <Avatar className="h-8 w-8 border-2 border-border">
              <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -right-0.5 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
          </div>
        ) : (
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
        )}
      </div>

      <Separator />

      {/* Workbench nav */}
      <div className={`flex-1 overflow-y-auto py-3 ${collapsed ? "px-1.5" : "px-3"}`}>
        {!collapsed && (
          <p className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Axiom Workbench
          </p>
        )}
        <nav className="space-y-0.5">
          {WORKBENCH_ITEMS.map((item) => (
            <button
              key={item.label}
              className={`flex w-full items-center rounded-md transition-colors ${
                collapsed
                  ? "justify-center px-0 py-2"
                  : "gap-2.5 px-2 py-1.5"
              } text-sm ${
                item.active
                  ? `${collapsed ? "" : "border-l-2 border-primary"} bg-primary/5 font-medium text-foreground`
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Expand button (collapsed only) */}
      {collapsed && (
        <>
          <Separator />
          <div className="flex justify-center py-2">
            <button
              onClick={() => setCollapsed(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Expand panel"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      <button
        onClick={onLogout}
        className={`flex items-center border-t text-sm text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 ${
          collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"
        }`}
        title={collapsed ? "Sign Out" : undefined}
      >
        <LogOut className="h-4 w-4" />
        {!collapsed && "Sign Out"}
      </button>
    </aside>
  );
}
