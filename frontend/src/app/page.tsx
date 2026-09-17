"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { NavPanel } from "@/components/layout/NavPanel";
import { CenterStage } from "@/components/layout/CenterStage";
import { RightSidebar } from "@/components/layout/RightSidebar";
import {
  ActivityOverlay,
  INITIAL_ACTIVITIES,
} from "@/components/activity/ActivityFeed";
import type { Activity } from "@/components/activity/ActivityFeed";
import type { WikiPage } from "@/components/layout/CenterStage";
import { INITIAL_WIKI_PAGES } from "@/components/layout/CenterStage";
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
  const [wikiPages, setWikiPages] = useState<WikiPage[]>(INITIAL_WIKI_PAGES);
  const [wikiPageId, setWikiPageId] = useState<string | null>(null);
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);

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

  const handleDiscussWithTutor = useCallback((context: string) => {
    setExpandedActivityId(null);
    setPendingChatMessage(context);
  }, []);

  const handleWikiSelect = useCallback((id: string) => {
    setWikiPageId(id);
    setActiveTab("wiki");
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
    <div className="flex h-screen overflow-hidden bg-background">
        <LeftSidebar user={user} onLogout={handleLogout} />
        <NavPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={user.role}
          wikiPages={wikiPages}
          onWikiSelect={handleWikiSelect}
        />
        <CenterStage
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={user.role}
          activities={activities}
          onActivitiesChange={setActivities}
          onExpandActivity={handleExpandActivity}
          wikiPages={wikiPages}
          onWikiPagesChange={setWikiPages}
          wikiPageId={wikiPageId}
          onWikiPageSelect={setWikiPageId}
          pendingChatMessage={pendingChatMessage}
          onPendingChatMessageHandled={() => setPendingChatMessage(null)}
        />
        <RightSidebar
          user={user}
          onActivityClick={handleExpandActivity}
        />

      {/* Fullscreen activity overlay */}
      {expandedActivityId && (
        <ActivityOverlay
          activityId={expandedActivityId}
          activities={activities}
          onClose={handleCloseActivity}
          onDiscussWithTutor={handleDiscussWithTutor}
        />
      )}
    </div>
  );
}
