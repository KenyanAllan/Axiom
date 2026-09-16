"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { NavPanel } from "@/components/layout/NavPanel";
import { CenterStage } from "@/components/layout/CenterStage";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { useDemoUser } from "@/hooks/use-demo-user";
import type { ViewTab } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const { user, isLoggedIn, logout } = useDemoUser();
  const [activeTab, setActiveTab] = useState<ViewTab>("activity");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (mounted && !isLoggedIn) {
      router.push("/login");
    }
  }, [mounted, isLoggedIn, router]);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  // Show nothing while checking auth state to avoid flicker
  if (!mounted || !isLoggedIn || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            AK
          </div>
          <span className="font-mono text-lg font-semibold">APKGS</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Top bar — full width, brand only */}
      <TopBar />

      {/* Main body — horizontal layout */}
      <div className="flex min-h-0 flex-1">
        {/* Far-left: profile + workbench nav */}
        <LeftSidebar user={user} onLogout={handleLogout} />

        {/* Second column: content nav links */}
        <NavPanel activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Center stage — tabs + content */}
        <CenterStage activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Right sidebar — XP, mastery, timeline */}
        <RightSidebar user={user} />
      </div>
    </div>
  );
}
