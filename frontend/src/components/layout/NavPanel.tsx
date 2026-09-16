"use client";

import {
  Plus,
  LayoutList,
  MessageSquare,
  BookText,
  FileText,
  Settings,
  BarChart3,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { UserRole, ViewTab } from "@/lib/types";

interface NavPanelProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  userRole: UserRole;
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
  { key: "chat", label: "Chat History", icon: <MessageSquare className="h-4 w-4" /> },
  { key: "wiki", label: "Wiki", icon: <BookText className="h-4 w-4" /> },
  { key: "sources", label: "Source Docs", icon: <FileText className="h-4 w-4" /> },
  { key: "dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" />, teacherOnly: true },
];

export function NavPanel({ activeTab, onTabChange, userRole }: NavPanelProps) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.teacherOnly || userRole === "teacher"
  );

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r bg-background">
      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {visibleItems.map((item, i) => {
          const isActive = item.key !== "new_chat" && item.key === activeTab;
          return (
            <button
              key={`${item.key}-${i}`}
              onClick={() => {
                if (item.key !== "new_chat") onTabChange(item.key);
              }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary/5 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <Separator />

      {/* Active track */}
      <div className="px-4 py-3">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Active Track
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="truncate">Applied Linear Alge...</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            8/12
          </span>
        </div>
      </div>

      <Separator />

      {/* Settings */}
      <button className="flex items-center gap-2.5 px-5 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <Settings className="h-4 w-4" />
        <span>Settings</span>
      </button>
    </aside>
  );
}
