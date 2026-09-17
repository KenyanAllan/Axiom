"use client";

import { useState, useEffect, useCallback } from "react";
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
import { listWorkspaces } from "@/lib/api";
import type { UserProfile, ViewTab, WorkspaceResponse } from "@/lib/types";

interface LeftSidebarProps {
  user: UserProfile;
  onLogout: () => void;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  studentView?: boolean;
  onToggleStudentView?: () => void;
}

export function LeftSidebar({ user, onLogout, activeTab, onTabChange, studentView, onToggleStudentView }: LeftSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  const initials = user.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const loadWorkspaces = useCallback(() => {
    listWorkspaces(user.id)
      .then((ws) => {
        setWorkspaces(ws);
        if (ws.length > 0 && activeId === null) {
          setActiveId(ws[0].id);
        }
      })
      .catch(() => {});
  }, [user.id, activeId]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleCreated = () => {
    setShowModal(false);
    loadWorkspaces();
  };

  return (
    <>
      <aside
        className={`flex shrink-0 flex-col border-r bg-background transition-all duration-200 ${
          collapsed ? "w-[52px]" : "w-[220px]"
        }`}
      >
        {/* Brand */}
        <div className={`flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-4"} py-3`}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
            Ax
          </div>
          {!collapsed && (
            <span className="font-mono text-sm font-semibold tracking-tight">
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
        <div className={`overflow-y-auto py-3 ${collapsed ? "px-1.5" : "px-3"}`}>
          {!collapsed && (
            <p className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Workbenches
            </p>
          )}
          <nav className="space-y-0.5">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setActiveId(ws.id)}
                className={`flex w-full items-center rounded-md transition-colors ${
                  collapsed
                    ? "justify-center px-0 py-2"
                    : "gap-2.5 px-2 py-1.5"
                } text-sm ${
                  ws.id === activeId
                    ? `${collapsed ? "" : "border-l-2 border-primary"} bg-primary/5 font-medium text-foreground`
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
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
            className={`mt-2 flex w-full items-center rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground ${
              collapsed
                ? "justify-center px-0 py-2"
                : "gap-2 px-2 py-1.5"
            }`}
            title={collapsed ? "New Workbench" : undefined}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && "New Workbench"}
          </button>
        </div>

        {/* Collapse toggle — immediately below workbenches */}
        <div className={`flex items-center border-t ${collapsed ? "justify-center px-0" : "justify-end px-3"} py-1.5`}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                ? "bg-amber-50 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            } ${collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"}`}
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
              ? "bg-primary/5 font-medium text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          } ${collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"}`}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings className="h-4 w-4" />
          {!collapsed && "Settings"}
        </button>

        <button
          onClick={onLogout}
          className={`flex items-center border-t text-sm text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 ${
            collapsed ? "justify-center py-2.5" : "gap-2.5 px-5 py-2.5"
          }`}
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
