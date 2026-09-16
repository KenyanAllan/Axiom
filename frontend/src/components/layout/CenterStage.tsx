"use client";

import {
  LayoutList,
  MessageSquare,
  BookText,
  GitBranch,
  FileText,
  RefreshCw,
  Sparkles,
  ArrowUp,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { SourceDocsManager } from "@/components/sources/SourceDocsManager";
import type { ViewTab } from "@/lib/types";

interface CenterStageProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
}

export function CenterStage({ activeTab, onTabChange }: CenterStageProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Tab bar */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as ViewTab)}
        className="flex flex-1 flex-col"
      >
        <div className="flex items-center border-b">
          <TabsList className="flex-1">
            <TabsTrigger value="activity" className="gap-1.5">
              <LayoutList className="h-3.5 w-3.5" />
              Activity Feed
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Chat Interface
            </TabsTrigger>
            <TabsTrigger value="wiki" className="gap-1.5">
              <BookText className="h-3.5 w-3.5" />
              Wiki Note
            </TabsTrigger>
            <TabsTrigger value="nodemap" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Node Map
            </TabsTrigger>
            <TabsTrigger value="sources" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Source Docs
            </TabsTrigger>
          </TabsList>
          <button className="px-3 text-muted-foreground transition-colors hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Tab content */}
        <TabsContent value="activity" className="flex-1 overflow-y-auto">
          <ActivityFeed />
        </TabsContent>

        <TabsContent value="chat" className="flex-1 p-6">
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-medium">Chat Interface</p>
              <p className="mt-1 text-xs">Start a conversation about any topic.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="wiki" className="flex-1 p-6">
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <BookText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-medium">Wiki Notes</p>
              <p className="mt-1 text-xs">Your personal knowledge base.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="nodemap" className="flex-1 p-6">
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <GitBranch className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-medium">Knowledge Node Map</p>
              <p className="mt-1 text-xs">
                Topic dependency graph powered by @xyflow/react.
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sources" className="flex-1 overflow-y-auto">
          <SourceDocsManager />
        </TabsContent>
      </Tabs>

      {/* Bottom input bar */}
      <div className="border-t px-5 py-3">
        <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Ask a question, request a hint, or search APKGS vaults..."
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
