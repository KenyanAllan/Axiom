"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "axiom_settings";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  fontScale: number;
  ttsVoice: string;
  ttsSpeed: number;
  autoReadChat: boolean;
  voiceInputLang: string;
}

const DEFAULTS: AppSettings = {
  theme: "system",
  fontScale: 1.3,
  ttsVoice: "",
  ttsSpeed: 1,
  autoReadChat: false,
  voiceInputLang: "en-US",
};

function load(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = { ...DEFAULTS, ...JSON.parse(raw) };
      if (parsed.fontScale === 1) parsed.fontScale = DEFAULTS.fontScale;
      return parsed;
    }
  } catch (err) { console.warn("use-settings: failed to parse stored settings:", err); }
  return DEFAULTS;
}

function save(settings: AppSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(load);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettingsState((prev) => {
      const next = { ...prev, [key]: value };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettingsState(DEFAULTS);
    save(DEFAULTS);
  }, []);

  return { settings, update, reset };
}
