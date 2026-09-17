"use client";

import { useState, useCallback, useEffect } from "react";
import type { UserProfile } from "@/lib/types";

const STORAGE_KEY = "axiom_current_user";

// Pre-seeded demo accounts
const DEMO_USERS: Record<string, UserProfile> = {
  usr_student_demo: {
    id: "usr_student_demo",
    display_name: "Sam Richards",
    role: "student",
    xp: 3450,
    level: 11,
    streak_days: 6,
  },
  usr_teacher_demo: {
    id: "usr_teacher_demo",
    display_name: "Prof. Torres",
    role: "teacher",
    xp: 0,
    level: 1,
    streak_days: 0,
  },
};

function getStoredUsers(): Record<string, UserProfile> {
  if (typeof window === "undefined") return DEMO_USERS;
  try {
    const stored = localStorage.getItem("axiom_users");
    if (stored) {
      return { ...DEMO_USERS, ...JSON.parse(stored) };
    }
  } catch {}
  return DEMO_USERS;
}

function saveCustomUsers(users: Record<string, UserProfile>) {
  if (typeof window === "undefined") return;
  // Only save non-demo users
  const custom: Record<string, UserProfile> = {};
  for (const [k, v] of Object.entries(users)) {
    if (!DEMO_USERS[k]) custom[k] = v;
  }
  localStorage.setItem("axiom_users", JSON.stringify(custom));
}

export function useDemoUser() {
  const [allUsers, setAllUsers] = useState<Record<string, UserProfile>>(getStoredUsers);
  const [userId, setUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  const user = userId ? allUsers[userId] ?? null : null;
  const isLoggedIn = user !== null;

  const login = useCallback((id: string) => {
    if (allUsers[id]) {
      setUserId(id);
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, [allUsers]);

  const signup = useCallback((id: string, displayName: string, role: "student" | "teacher") => {
    const profile: UserProfile = {
      id,
      display_name: displayName,
      role,
      xp: 0,
      level: 1,
      streak_days: 0,
    };
    const updated = { ...allUsers, [id]: profile };
    setAllUsers(updated);
    saveCustomUsers(updated);
    setUserId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, [allUsers]);

  const logout = useCallback(() => {
    setUserId(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const switchUser = useCallback((id: string) => {
    login(id);
  }, [login]);

  const updateXP = useCallback((xp: number, level: number) => {
    if (!userId || !allUsers[userId]) return;
    const updated = { ...allUsers };
    updated[userId] = { ...updated[userId], xp, level };
    setAllUsers(updated);
  }, [userId, allUsers]);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    if (!userId || !allUsers[userId]) return;
    const updated = { ...allUsers };
    updated[userId] = { ...updated[userId], ...patch };
    setAllUsers(updated);
    saveCustomUsers(updated);
  }, [userId, allUsers]);

  return {
    user,
    userId,
    isLoggedIn,
    allUsers,
    login,
    signup,
    logout,
    switchUser,
    updateXP,
    updateProfile,
  };
}
