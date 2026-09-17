"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BookOpen,
  Eye,
  EyeOff,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { parseAvatar } from "@/components/settings/SettingsPage";
import { NewWorkbenchModal } from "@/components/workbench/NewWorkbenchModal";
import { listWorkbenches } from "@/lib/api";
import type { UserProfile, ViewTab, WorkbenchResponse } from "@/lib/types";

interface LeftSidebarProps {
  user: UserProfile;
  onLogout: () => void;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  studentView?: boolean;
  onToggleStudentView?: () => void;
  activeWorkbenchId?: number | null;
  onWorkbenchChange?: (id: number) => void;
}

export function LeftSidebar({ user, onLogout, activeTab, onTabChange, studentView, onToggleStudentView, activeWorkbenchId, onWorkbenchChange }: LeftSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [workbenches, setWorkbenches] = useState<WorkbenchResponse[]>([]);

  const initials = user.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const onWorkbenchChangeRef = useRef(onWorkbenchChange);
  onWorkbenchChangeRef.current = onWorkbenchChange;
  const activeIdRef = useRef(activeWorkbenchId);
  activeIdRef.current = activeWorkbenchId;

  const loadWorkbenches = useCallback(() => {
    listWorkbenches(user.id)
      .then((ws) => {
        setWorkbenches(ws);
        if (ws.length > 0 && activeIdRef.current == null) {
          onWorkbenchChangeRef.current?.(ws[0].id);
        }
      })
      .catch(() => {});
  }, [user.id]);

  useEffect(() => {
    loadWorkbenches();
  }, [loadWorkbenches]);

  const handleCreated = (newWorkbench?: WorkbenchResponse) => {
    setShowModal(false);
    if (newWorkbench) {
      setWorkbenches((prev) => [...prev, newWorkbench]);
      onWorkbenchChange?.(newWorkbench.id);
    } else {
      loadWorkbenches();
    }
  };

  return (
    <>
      <aside
        className={`flex shrink-0 flex-col border-r transition-all duration-200 ${
          collapsed ? "w-[52px]" : "w-[220px]"
        }`}
        style={{ backgroundColor: "hsl(var(--sidebar))", color: "hsl(var(--sidebar-foreground))", borderColor: "hsl(var(--sidebar-border))" }}
      >
        {/* Brand */}
        <div className={`flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-4"} py-4`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            Ax
          </div>
          {!collapsed && (
            <span className="font-mono text-lg font-bold tracking-tight">
              Axiom
            </span>
          )}
        </div>

        {/* User profile */}
        <div className={collapsed ? "flex justify-center py-4" : "px-3 py-4"}>
          {collapsed ? (
            <div className="relative" title={`${user.display_name} — ${user.role}`}>
              {user.avatar ? (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-base"
                  style={{ backgroundColor: parseAvatar(user.avatar).color }}
                >
                  {parseAvatar(user.avatar).icon}
                </div>
              ) : (
                <Avatar className="h-8 w-8 border-2 border-border">
                  <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              )}
              <span className="absolute -right-0.5 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="relative">
                {user.avatar ? (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
                    style={{ backgroundColor: parseAvatar(user.avatar).color }}
                  >
                    {parseAvatar(user.avatar).icon}
                  </div>
                ) : (
                  <Avatar className="h-10 w-10 border-2 border-border">
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className="absolute -right-0.5 bottom-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold">{user.display_name}</p>
                <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
                  {user.role}
                </p>
                <p className="font-mono text-[11px]" style={{ color: "hsl(var(--sidebar-muted))" }}>
                  Lvl {user.level}
                </p>
              </div>
            </div>
          )}
        </div>

        <div style={{ borderColor: "hsl(var(--sidebar-border))" }} className="border-t" />

        {/* Workbench nav */}
        <div className={`overflow-y-auto py-3 ${collapsed ? "px-1.5" : "px-3"}`}>
          {!collapsed && (
            <p className="mb-2 px-2 font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--sidebar-muted))" }}>
              Workbenches
            </p>
          )}
          <nav className="space-y-0.5">
            {workbenches.map((ws) => (
              <button
                key={ws.id}
                onClick={() => onWorkbenchChange?.(ws.id)}
                className={`flex w-full items-center rounded-md transition-colors ${
                  collapsed
                    ? "justify-center px-0 py-2"
                    : "gap-2.5 px-2 py-1.5"
                } text-sm ${
                  ws.id === activeWorkbenchId
                    ? `${collapsed ? "" : "border-l-2 border-primary"} bg-primary/10 font-medium`
                    : "hover:bg-primary/5"
                }`}
                style={ws.id !== activeWorkbenchId ? { color: "hsl(var(--sidebar-muted))" } : undefined}
                title={collapsed ? ws.title : undefined}
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{ws.title}</span>}
              </button>
            ))}
          </nav>

          {/* New Workbench button */}
          <button
            onClick={() => setShowModal(true)}
            className={`mt-2 flex w-full items-center rounded-md border border-dashed text-sm transition-colors hover:border-primary hover:text-primary ${
              collapsed
                ? "justify-center px-0 py-2"
                : "gap-2 px-2 py-1.5"
            }`}
            style={{ color: "hsl(var(--sidebar-muted))", borderColor: "hsl(var(--sidebar-border))" }}
            title={collapsed ? "New Workbench" : undefined}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && "New Workbench"}
          </button>
        </div>

        {/* Collapse toggle — immediately below workbenches */}
        <div className={`flex items-center ${collapsed ? "justify-center px-0" : "justify-end px-3"} py-1.5`} style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-primary/10"
            style={{ color: "hsl(var(--sidebar-muted))" }}
            title={collapsed ? "Expand panel" : "Collapse panel"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Spacer pushes bottom buttons down */}
        <div className="flex-1" />

        {/* Student View toggle — teachers only */}
        {user.role === "teacher" && onToggleStudentView && (
          <button
            onClick={onToggleStudentView}
            className={`flex items-center border-t text-sm transition-colors ${
              studentView
                ? "bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400"
                : "hover:bg-primary/5"
            } ${collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"}`}
            style={{ borderColor: "hsl(var(--sidebar-border))", ...(!studentView ? { color: "hsl(var(--sidebar-muted))" } : {}) }}
            title={collapsed ? (studentView ? "Exit Student View" : "Student View") : undefined}
          >
            {studentView ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {!collapsed && (studentView ? "Exit Student View" : "Student View")}
          </button>
        )}

        {/* Settings */}
        <button
          onClick={() => onTabChange("settings")}
          className={`flex items-center border-t text-sm transition-colors ${
            activeTab === "settings"
              ? "bg-primary/10 font-medium"
              : "hover:bg-primary/5"
          } ${collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"}`}
          style={{ borderColor: "hsl(var(--sidebar-border))", ...(activeTab !== "settings" ? { color: "hsl(var(--sidebar-muted))" } : {}) }}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings className="h-4 w-4" />
          {!collapsed && "Settings"}
        </button>

        <button
          onClick={onLogout}
          className={`flex items-center border-t text-sm transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 ${
            collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"
          }`}
          style={{ color: "hsl(var(--sidebar-muted))", borderColor: "hsl(var(--sidebar-border))" }}
          title={collapsed ? "Sign Out" : undefined}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && "Sign Out"}
        </button>
      </aside>

      {showModal && (
        <NewWorkbenchModal
          userId={user.id}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
