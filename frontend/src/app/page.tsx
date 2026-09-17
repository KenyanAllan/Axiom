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
import type { ChatSession } from "@/components/layout/CenterStage";
import { SEED_SESSION } from "@/components/layout/CenterStage";
import { useDemoUser } from "@/hooks/use-demo-user";
import { useSettings } from "@/hooks/use-settings";
import type { ViewTab } from "@/lib/types";
import {
  fetchActivityFeed,
  fetchTopics,
  fetchClaims,
  listChatSessions,
  getChatSession,
} from "@/lib/api";
import { XP_BY_TYPE } from "@/components/activity/ActivityFeed";

export default function Home() {
  const router = useRouter();
  const { user, isLoggedIn, logout, updateProfile } = useDemoUser();
  const { settings, update: updateSetting } = useSettings();
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
  const [studentView, setStudentView] = useState(false);

  // ── Chat session state ────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<ChatSession[]>([SEED_SESSION]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>("seed");

  useEffect(() => {
    setMounted(true);
    if (user?.role === "teacher") {
      setActiveTab("dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.style.fontSize = `${settings.fontScale * 100}%`;
  }, [settings.fontScale]);

  useEffect(() => {
    if (mounted && !isLoggedIn) {
      router.push("/login");
    }
  }, [mounted, isLoggedIn, router]);

  // ── Load chat sessions from API ─────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    listChatSessions(user.id)
      .then(async (apiSessions) => {
        if (apiSessions.length === 0) return;
        const loaded: ChatSession[] = await Promise.all(
          apiSessions.slice(0, 10).map(async (s) => {
            try {
              const detail = await getChatSession(user.id, s.id);
              return {
                id: `backend_${s.id}`,
                backendId: s.id,
                title: s.title,
                messages: detail.messages.map((m, i) => ({
                  id: `bm_${s.id}_${i}`,
                  role: m.role as "user" | "assistant",
                  text: m.content,
                  time: new Date(m.created_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                })),
              };
            } catch {
              return {
                id: `backend_${s.id}`,
                backendId: s.id,
                title: s.title,
                messages: [],
              };
            }
          })
        );
        if (loaded.length > 0) {
          setSessions((prev) => [...prev, ...loaded]);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  // ── Load activity feed from API ─────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    fetchActivityFeed(user.id)
      .then((data) => {
        if (data.cards.length > 0) {
          const mapped: Activity[] = data.cards.map((card) => {
            const actType = card.diagnostic_type === "feynman"
              ? "feynman" as const
              : card.diagnostic_type === "wrong_on_purpose"
                ? "wrong_on_purpose" as const
                : "flashcard" as const;
            return {
              id: card.claim_id,
              type: actType,
              title: card.claim_title,
              topic: card.topic_title,
              xp: XP_BY_TYPE[actType] ?? 25,
            };
          });
          setActivities(mapped);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  // ── Load topics + claims for wiki ───────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    Promise.all([fetchTopics(user.id), fetchClaims(user.id)])
      .then(([topics, claims]) => {
        if (topics.length === 0) return;
        const pages: WikiPage[] = topics.map((t) => {
          const topicClaims = claims.filter((c) => c.topic_id === t.id);
          return {
            id: t.id,
            title: t.title,
            aliases: [t.slug],
            snippet: t.summary ?? "",
            updated: "Sep 16",
            claims: topicClaims.map((c) => ({
              id: c.id,
              title: c.title,
              description: c.content,
              anchors: c.rubric ? [c.rubric] : [],
            })),
          };
        });
        setWikiPages(pages);
      })
      .catch(() => {});
  }, [user?.id]);

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

  const handleDeleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      setActiveSessionId((prevId) =>
        prevId === id ? (remaining[0]?.id ?? null) : prevId
      );
      return remaining;
    });
  }, []);

  const effectiveRole = studentView && user?.role === "teacher" ? "student" as const : user?.role ?? "student" as const;

  const handleToggleStudentView = useCallback(() => {
    setStudentView((prev) => !prev);
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
        <LeftSidebar
          user={user}
          onLogout={handleLogout}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          studentView={studentView}
          onToggleStudentView={handleToggleStudentView}
        />
        <NavPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={effectiveRole}
          wikiPages={wikiPages}
          onWikiSelect={handleWikiSelect}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={setActiveSessionId}
          onDeleteSession={handleDeleteSession}
        />
        <CenterStage
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={effectiveRole}
          userId={user.id}
          activities={activities}
          onActivitiesChange={setActivities}
          onExpandActivity={handleExpandActivity}
          wikiPages={wikiPages}
          onWikiPagesChange={setWikiPages}
          wikiPageId={wikiPageId}
          onWikiPageSelect={setWikiPageId}
          pendingChatMessage={pendingChatMessage}
          onPendingChatMessageHandled={() => setPendingChatMessage(null)}
          sessions={sessions}
          onSessionsChange={setSessions}
          activeSessionId={activeSessionId}
          onActiveSessionIdChange={setActiveSessionId}
          onDeleteSession={handleDeleteSession}
          user={user}
          settings={settings}
          onUpdateProfile={updateProfile}
          onUpdateSetting={updateSetting}
        />
        <RightSidebar
          user={user}
          onActivityClick={handleExpandActivity}
          userRole={effectiveRole}
        />

      {/* Fullscreen activity overlay */}
      {expandedActivityId && (
        <ActivityOverlay
          activityId={expandedActivityId}
          activities={activities}
          onClose={handleCloseActivity}
          onDiscussWithTutor={handleDiscussWithTutor}
          onActivitiesChange={setActivities}
        />
      )}
    </div>
  );
}
