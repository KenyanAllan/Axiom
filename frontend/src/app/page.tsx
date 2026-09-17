"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { NavPanel } from "@/components/layout/NavPanel";
import { CenterStage } from "@/components/layout/CenterStage";
import { RightSidebar } from "@/components/layout/RightSidebar";
import {
  ActivityOverlay,
  INITIAL_ACTIVITIES,
} from "@/components/activity/ActivityFeed";
import type { Activity } from "@/components/activity/ActivityFeed";
import { useDemoUser } from "@/hooks/use-demo-user";
import type { ViewTab } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const { user, isLoggedIn, logout } = useDemoUser();
  const [activeTab, setActiveTab] = useState<ViewTab>("activity");
  const [mounted, setMounted] = useState(false);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(
    null
  );
  const [activities, setActivities] =
    useState<Activity[]>(INITIAL_ACTIVITIES);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isLoggedIn) {
      router.push("/login");
    }
  }, [mounted, isLoggedIn, router]);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const handleExpandActivity = useCallback((id: string) => {
    setExpandedActivityId(id);
  }, []);

  const handleCloseActivity = useCallback(() => {
    setExpandedActivityId(null);
  }, []);

  if (!mounted || !isLoggedIn || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            Ax
          </div>
          <span className="font-mono text-lg font-semibold">Axiom</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <LeftSidebar user={user} onLogout={handleLogout} />
        <NavPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={user.role}
        />
        <CenterStage
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={user.role}
          activities={activities}
          onActivitiesChange={setActivities}
          onExpandActivity={handleExpandActivity}
        />
        <RightSidebar
          user={user}
          onActivityClick={handleExpandActivity}
        />
      </div>

      {/* Fullscreen activity overlay */}
      {expandedActivityId && (
        <ActivityOverlay
          activityId={expandedActivityId}
          activities={activities}
          onClose={handleCloseActivity}
        />
      )}
    </div>
  );
}
