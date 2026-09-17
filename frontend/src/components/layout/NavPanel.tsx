"use client";

import { useState } from "react";
import {
  Plus,
  LayoutList,
  MessageSquare,
  BookText,
  FileText,
  Settings,
  BarChart3,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { WikiPage, ChatSession } from "@/components/layout/CenterStage";
import type { UserRole, ViewTab } from "@/lib/types";

interface NavPanelProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  userRole: UserRole;
  wikiPages: WikiPage[];
  onWikiSelect: (id: string) => void;
  sessions?: ChatSession[];
  activeSessionId?: string | null;
  onSessionSelect?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
}

interface NavItem {
  key: ViewTab | "new_chat";
  label: string;
  icon: React.ReactNode;
  teacherOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "new_chat", label: "New Chat", icon: <Plus className="h-4 w-4" /> },
  { key: "activity", label: "Activity Feed", icon: <LayoutList className="h-4 w-4" /> },
  { key: "chat", label: "Chat", icon: <MessageSquare className="h-4 w-4" /> },
  { key: "wiki", label: "Wiki", icon: <BookText className="h-4 w-4" /> },
  { key: "nodemap", label: "Node Map", icon: <GitBranch className="h-4 w-4" /> },
  { key: "sources", label: "Source Docs", icon: <FileText className="h-4 w-4" /> },
  { key: "dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" />, teacherOnly: true },
];

export function NavPanel({ activeTab, onTabChange, userRole, wikiPages, onWikiSelect, sessions, activeSessionId, onSessionSelect, onDeleteSession }: NavPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.teacherOnly || userRole === "teacher"
  );

  return (
    <aside
      className={`flex shrink-0 flex-col border-r bg-background transition-all duration-200 ${
        collapsed ? "w-[52px]" : "w-[220px]"
      }`}
    >
      {/* Collapse toggle */}
      <div className={`flex items-center border-b ${collapsed ? "justify-center px-0" : "justify-end px-3"} py-2`}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={collapsed ? "Expand panel" : "Collapse panel"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav links */}
      <nav className={`flex-1 overflow-y-auto py-4 space-y-0.5 ${collapsed ? "px-1.5" : "px-3"}`}>
        {visibleItems.map((item, i) => {
          const isActive = item.key !== "new_chat" && item.key === activeTab;
          return (
            <button
              key={`${item.key}-${i}`}
              onClick={() => {
                onTabChange(item.key === "new_chat" ? "chat" : item.key);
              }}
              className={`flex w-full items-center rounded-md transition-colors ${
                collapsed
                  ? "justify-center px-0 py-2"
                  : "gap-2.5 px-2 py-1.5"
              } text-sm ${
                isActive
                  ? "bg-primary/5 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <Separator />

      {/* Conversations */}
      {!collapsed && sessions && sessions.length > 0 ? (
        <div className="px-4 py-3">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Conversations
          </p>
          <div className="space-y-0.5">
            {sessions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className={`group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent hover:text-foreground ${
                  activeSessionId === s.id
                    ? "bg-primary/5 font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <button
                  onClick={() => {
                    onSessionSelect?.(s.id);
                    onTabChange("chat");
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <MessageSquare className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">{s.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px]">
                    {s.messages.length}
                  </span>
                </button>
                {onDeleteSession && (
                  <button
                    onClick={() => onDeleteSession(s.id)}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete conversation"
                  >
                    <Trash2 className="h-3 w-3 text-red-400 hover:text-red-600" />
                  </button>
                )}
              </div>
            ))}
            {sessions.length > 5 && (
              <p className="px-2 font-mono text-[10px] text-muted-foreground">
                +{sessions.length - 5} more
              </p>
            )}
          </div>
        </div>
      ) : collapsed && sessions && sessions.length > 0 ? (
        <div className="flex flex-col items-center gap-1 py-3" title={`${sessions.length} conversations`}>
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[9px] text-muted-foreground">{sessions.length}</span>
        </div>
      ) : null}

      <Separator />

      {/* Active wikis */}
      {!collapsed ? (
        <div className="px-4 py-3">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Active Wikis
          </p>
          <div className="space-y-0.5">
            {wikiPages.slice(0, 4).map((wp) => (
              <button
                key={wp.id}
                onClick={() => onWikiSelect(wp.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <span className="min-w-0 truncate">{wp.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px]">
                  {wp.claims.length}
                </span>
              </button>
            ))}
            {wikiPages.length > 4 && (
              <p className="px-2 font-mono text-[10px] text-muted-foreground">
                +{wikiPages.length - 4} more
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 py-3" title={`${wikiPages.length} active wikis`}>
          <BookText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[9px] text-muted-foreground">{wikiPages.length}</span>
        </div>
      )}

      <Separator />

      {/* Settings */}
      <button
        className={`flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground ${
          collapsed ? "justify-center py-3" : "gap-2.5 px-5 py-3"
        }`}
        title={collapsed ? "Settings" : undefined}
      >
        <Settings className="h-4 w-4" />
        {!collapsed && <span>Settings</span>}
      </button>
    </aside>
  );
}
