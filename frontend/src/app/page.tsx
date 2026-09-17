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
import { CompletedActivityReviewOverlay } from "@/components/activity/CompletedActivityReviewOverlay";
import type { CompletedActivityReview } from "@/components/activity/CompletedActivityReviewOverlay";
import type { WikiPage } from "@/components/layout/CenterStage";
import { INITIAL_WIKI_PAGES } from "@/components/layout/CenterStage";
import type { ChatSession } from "@/components/layout/CenterStage";
import { SEED_SESSION } from "@/components/layout/CenterStage";
import { useDemoUser } from "@/hooks/use-demo-user";
import { useSettings } from "@/hooks/use-settings";
import type { ViewTab } from "@/lib/types";
import { mapBackendType } from "@/lib/types";
import {
  fetchActivityFeed,
  fetchActivityQueue,
  fetchTopics,
  fetchClaims,
  listChatSessions,
  getChatSession,
  createChatSession,
  deleteChatSession,
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
  const [pendingChatMessage, setPendingChatMessage] = useState<{ text: string; title?: string } | null>(null);
  const [studentView, setStudentView] = useState(false);
  const [reviewingActivity, setReviewingActivity] = useState<CompletedActivityReview | null>(null);
  const [pendingSourceDocId, setPendingSourceDocId] = useState<string | null>(null);

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
            } catch (err) {
              console.error("page.tsx: failed to load chat session detail:", err);
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
      .catch((err) => console.error("page.tsx: failed to load chat sessions:", err));
  }, [user?.id]);

  // ── Load activity feed + queue from API ──────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const loadFeed = fetchActivityFeed(user.id)
      .then((data) =>
        data.cards.map((card): Activity => {
          const dt = mapBackendType(card.diagnostic_type);
          const actType = dt === "feynman"
            ? "feynman" as const
            : dt === "myth_buster"
              ? "myth_buster" as const
              : "flashcard" as const;
          return {
            id: card.claim_id,
            type: actType,
            title: card.claim_title,
            topic: card.topic_title,
            xp: XP_BY_TYPE[actType] ?? 25,
          };
        })
      )
      .catch((err) => { console.error("page.tsx: failed to load activity feed:", err); return [] as Activity[]; });

    const loadQueue = fetchActivityQueue(user.id)
      .then((data) =>
        data.entries
          .filter((e) => !e.is_completed)
          .map((e): Activity => {
            const mapped = mapBackendType(e.activity.type) as Activity["type"];
            return {
              id: String(e.activity.id),
              type: mapped,
              title: e.activity.title,
              topic: "",
              xp: XP_BY_TYPE[mapped as keyof typeof XP_BY_TYPE] ?? 25,
              payload: e.activity.payload,
            };
          })
      )
      .catch((err) => { console.error("page.tsx: failed to load activity queue:", err); return [] as Activity[]; });

    Promise.all([loadFeed, loadQueue]).then(([feedItems, queueItems]) => {
      const seen = new Set<string>();
      const merged: Activity[] = [];
      for (const item of [...queueItems, ...feedItems]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
      if (merged.length > 0) {
        setActivities(merged);
      }
    });
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
              sourceDocumentId: c.source_document_id != null ? String(c.source_document_id) : null,
            })),
          };
        });
        setWikiPages(pages);
      })
      .catch((err) => console.error("page.tsx: failed to load topics/claims for wiki:", err));
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
    setPendingChatMessage({ text: context });
  }, []);

  const handleWikiSelect = useCallback((id: string) => {
    setWikiPageId(id);
    setActiveTab("wiki");
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    const session = sessions.find((s) => s.id === id);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      setActiveSessionId((prevId) =>
        prevId === id ? (remaining[0]?.id ?? null) : prevId
      );
      return remaining;
    });
    if (session?.backendId && user?.id) {
      deleteChatSession(user.id, session.backendId).catch((err) => console.error("page.tsx: failed to delete backend chat session:", err));
    }
  }, [sessions, user?.id]);

  const handleCreateNewChat = useCallback(async () => {
    const localId = `new_chat_${Date.now()}`;
    const newSession: ChatSession = { id: localId, title: "New Chat", messages: [] };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(localId);
    setActiveTab("chat");

    if (user?.id) {
      try {
        const backendSession = await createChatSession(user.id);
        setSessions((prev) =>
          prev.map((s) => (s.id === localId ? { ...s, backendId: backendSession.id } : s))
        );
      } catch (err) {
        console.error("page.tsx: failed to create backend chat session:", err);
      }
    }
  }, [user?.id]);

  const effectiveRole = studentView && user?.role === "teacher" ? "student" as const : user?.role ?? "student" as const;

  const handleToggleStudentView = useCallback(() => {
    setStudentView((prev) => !prev);
  }, []);

  const handleReviewActivity = useCallback((review: CompletedActivityReview) => {
    setReviewingActivity(review);
  }, []);

  const handleCloseReview = useCallback(() => {
    setReviewingActivity(null);
  }, []);

  const handleReviewDiscussWithTutor = useCallback((context: string) => {
    const title = reviewingActivity?.activityTitle ?? undefined;
    setReviewingActivity(null);
    setPendingChatMessage({ text: context, title });
  }, [reviewingActivity]);

  const handleViewSource = useCallback((sourceDocumentId: string) => {
    setPendingSourceDocId(sourceDocumentId);
    setActiveTab("sources");
  }, []);

  if (!mounted || !isLoggedIn || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-6">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-primary text-4xl font-bold text-primary-foreground">
            Ax
          </div>
          <span className="font-mono text-6xl font-semibold">Axiom</span>
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
          onCreateNewChat={handleCreateNewChat}
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
          onReviewActivity={handleReviewActivity}
          onViewSource={handleViewSource}
          pendingSourceDocId={pendingSourceDocId}
          onPendingSourceDocHandled={() => setPendingSourceDocId(null)}
        />
        <RightSidebar
          user={user}
          onActivityClick={handleExpandActivity}
          userRole={effectiveRole}
          onTabChange={setActiveTab}
          onReviewActivity={handleReviewActivity}
        />

      {/* Fullscreen activity overlay */}
      {expandedActivityId && (
        <ActivityOverlay
          activityId={expandedActivityId}
          activities={activities}
          userId={user.id}
          onClose={handleCloseActivity}
          onDiscussWithTutor={handleDiscussWithTutor}
          onActivitiesChange={setActivities}
        />
      )}

      {/* Completed activity review overlay */}
      {reviewingActivity && (
        <CompletedActivityReviewOverlay
          review={reviewingActivity}
          userId={user.id}
          onClose={handleCloseReview}
          onDiscussWithTutor={handleReviewDiscussWithTutor}
        />
      )}
    </div>
  );
}
