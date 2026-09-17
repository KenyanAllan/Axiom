"use client";

import { useState, useEffect, useCallback } from "react";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Monitor,
  Type,
  Volume2,
  Mic,
  MessageSquare,
  Check,
  RefreshCw,
  Globe,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { UserProfile } from "@/lib/types";
import type { AppSettings } from "@/hooks/use-settings";
import { updateUserProfile } from "@/lib/api";

// ── Avatar system ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const AVATAR_ICONS = [
  "🧠", "🔬", "📐", "💡", "🎯", "🚀", "⚡", "🧮", "📊", "🎓",
  "🌟", "🔭", "🧪", "📚", "🎨",
];

function randomAvatar(): string {
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const icon = AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)];
  return `${icon}|${color}`;
}

function parseAvatar(avatar?: string): { icon: string; color: string } {
  if (!avatar || !avatar.includes("|")) {
    return { icon: "🧠", color: "#3b82f6" };
  }
  const [icon, color] = avatar.split("|");
  return { icon, color };
}

function AvatarPreview({ avatar, size = 64 }: { avatar?: string; size?: number }) {
  const { icon, color } = parseAvatar(avatar);
  return (
    <div
      className="flex items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.45 }}
    >
      {icon}
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface SettingsPageProps {
  user: UserProfile;
  settings: AppSettings;
  onUpdateProfile: (patch: Partial<UserProfile>) => void;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsPage({ user, settings, onUpdateProfile, onUpdateSetting }: SettingsPageProps) {
  const { setTheme } = useTheme();

  const [email, setEmail] = useState(user.email ?? "");
  const [emailSaved, setEmailSaved] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const POLLY_VOICES = [
    { id: "Joanna", label: "Joanna (US English, Female)" },
    { id: "Matthew", label: "Matthew (US English, Male)" },
    { id: "Salli", label: "Salli (US English, Female)" },
    { id: "Ivy", label: "Ivy (US English, Female, Child)" },
    { id: "Kendra", label: "Kendra (US English, Female)" },
    { id: "Joey", label: "Joey (US English, Male)" },
    { id: "Ruth", label: "Ruth (US English, Female, Neural)" },
    { id: "Stephen", label: "Stephen (US English, Male, Neural)" },
    { id: "Amy", label: "Amy (British English, Female)" },
    { id: "Brian", label: "Brian (British English, Male)" },
    { id: "Emma", label: "Emma (British English, Female)" },
    { id: "Lupe", label: "Lupe (US Spanish, Female)" },
    { id: "Penelope", label: "Penelope (US Spanish, Female)" },
    { id: "Léa", label: "Léa (French, Female)" },
    { id: "Vicki", label: "Vicki (German, Female)" },
    { id: "Zhiyu", label: "Zhiyu (Chinese Mandarin, Female)" },
    { id: "Takumi", label: "Takumi (Japanese, Male)" },
    { id: "Seoyeon", label: "Seoyeon (Korean, Female)" },
  ];

  useEffect(() => {
    document.documentElement.style.fontSize = `${settings.fontScale * 100}%`;
  }, [settings.fontScale]);

  const handleSaveEmail = () => {
    const trimmed = email.trim();
    onUpdateProfile({ email: trimmed });
    setEmailSaved(true);
    setTimeout(() => setEmailSaved(false), 2000);
    updateUserProfile(user.id, { email: trimmed || null }).catch((err) => console.error("SettingsPage: failed to update email:", err));
  };

  const handleChangePassword = () => {
    setPasswordMsg(null);
    if (!newPassword.trim()) {
      setPasswordMsg({ type: "err", text: "New password cannot be empty." });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "err", text: "Passwords do not match." });
      return;
    }
    if (user.password && currentPassword !== user.password) {
      setPasswordMsg({ type: "err", text: "Current password is incorrect." });
      return;
    }
    onUpdateProfile({ password: newPassword });
    setPasswordMsg({ type: "ok", text: "Password updated." });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleTheme = (theme: "light" | "dark" | "system") => {
    onUpdateSetting("theme", theme);
    setTheme(theme);
  };

  const saveAvatar = (avatar: string) => {
    onUpdateProfile({ avatar });
    updateUserProfile(user.id, { avatar }).catch((err) => console.error("SettingsPage: failed to update avatar:", err));
  };

  const handleRandomAvatar = () => {
    saveAvatar(randomAvatar());
  };

  // Assign random avatar on first visit
  useEffect(() => {
    if (!user.avatar) handleRandomAvatar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const LANG_OPTIONS = [
    { value: "en-US", label: "English (US)" },
    { value: "en-GB", label: "English (UK)" },
    { value: "es-ES", label: "Spanish" },
    { value: "fr-FR", label: "French" },
    { value: "de-DE", label: "German" },
    { value: "zh-CN", label: "Chinese (Simplified)" },
    { value: "ja-JP", label: "Japanese" },
    { value: "ko-KR", label: "Korean" },
    { value: "pt-BR", label: "Portuguese (BR)" },
    { value: "ar-SA", label: "Arabic" },
    { value: "hi-IN", label: "Hindi" },
    { value: "it-IT", label: "Italian" },
    { value: "ru-RU", label: "Russian" },
    { value: "tr-TR", label: "Turkish" },
    { value: "vi-VN", label: "Vietnamese" },
    { value: "nl-NL", label: "Dutch" },
    { value: "pl-PL", label: "Polish" },
    { value: "th-TH", label: "Thai" },
    { value: "id-ID", label: "Indonesian" },
    { value: "sw-KE", label: "Swahili" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage your profile, appearance, and preferences.</p>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <User className="h-4 w-4" /> Profile
        </h2>

        <div className="mt-4 rounded-lg border bg-card">
          {/* Avatar */}
          <div className="flex items-center gap-4 border-b px-5 py-4">
            <AvatarPreview avatar={user.avatar} />
            <div className="flex-1">
              <p className="text-sm font-medium">{user.display_name}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.role.replace("_", " ")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={handleRandomAvatar}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <RefreshCw className="h-3 w-3" /> Randomize
              </button>
            </div>
          </div>

          {/* Avatar picker */}
          <div className="border-b px-5 py-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Pick an icon</p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_ICONS.map((icon) => {
                const current = parseAvatar(user.avatar);
                const isActive = current.icon === icon;
                return (
                  <button
                    key={icon}
                    onClick={() => saveAvatar(`${icon}|${parseAvatar(user.avatar).color}`)}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${isActive ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
                  >
                    {icon}
                  </button>
                );
              })}
            </div>
            <p className="mb-2 mt-3 text-xs font-medium text-muted-foreground">Pick a color</p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => {
                const current = parseAvatar(user.avatar);
                const isActive = current.color === color;
                return (
                  <button
                    key={color}
                    onClick={() => saveAvatar(`${parseAvatar(user.avatar).icon}|${color}`)}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${isActive ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          </div>

          {/* Email */}
          <div className="border-b px-5 py-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4 text-muted-foreground" /> Email
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={handleSaveEmail}
                disabled={!email.trim() || email === user.email}
                className="flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
              >
                {emailSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : "Save"}
              </button>
            </div>
          </div>

          {/* Password */}
          <div className="px-5 py-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4 text-muted-foreground" /> Change Password
            </label>
            <div className="mt-2 space-y-2">
              {user.password && (
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-primary"
                  />
                  <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-muted-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              )}
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleChangePassword}
                  disabled={!newPassword.trim()}
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
                >
                  Update Password
                </button>
                {passwordMsg && (
                  <span className={`text-xs font-medium ${passwordMsg.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                    {passwordMsg.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <Sun className="h-4 w-4" /> Appearance
        </h2>

        <div className="mt-4 rounded-lg border bg-card">
          {/* Theme */}
          <div className="border-b px-5 py-4">
            <p className="text-sm font-medium">Theme</p>
            <div className="mt-3 flex gap-2">
              {([
                { value: "light" as const, icon: Sun, label: "Light" },
                { value: "dark" as const, icon: Moon, label: "Dark" },
                { value: "system" as const, icon: Monitor, label: "System" },
              ]).map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => handleTheme(value)}
                  className={`flex flex-1 flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${
                    settings.theme === value ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Font scale */}
          <div className="px-5 py-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Type className="h-4 w-4 text-muted-foreground" /> Font Size
            </label>
            <p className="mt-2 text-center font-mono text-lg font-semibold">{Math.round(settings.fontScale * 100)}%</p>
            <input
              type="range"
              min={0.9}
              max={1.7}
              step={0.05}
              value={settings.fontScale}
              onChange={(e) => onUpdateSetting("fontScale", parseFloat(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </div>
        </div>
      </section>

      {/* ── Audio & Voice ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <Volume2 className="h-4 w-4" /> Audio & Voice
        </h2>

        <div className="mt-4 rounded-lg border bg-card">
          {/* TTS Voice */}
          <div className="border-b px-5 py-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Volume2 className="h-4 w-4 text-muted-foreground" /> Text-to-Speech Voice
            </label>
            <select
              value={settings.ttsVoice}
              onChange={(e) => onUpdateSetting("ttsVoice", e.target.value)}
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Default (Joanna)</option>
              {POLLY_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {/* TTS Speed */}
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Speech Speed</p>
              <span className="font-mono text-xs text-muted-foreground">{settings.ttsSpeed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.ttsSpeed}
              onChange={(e) => onUpdateSetting("ttsSpeed", parseFloat(e.target.value))}
              className="mt-3 w-full accent-primary"
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>0.5x</span>
              <span>1x</span>
              <span>2x</span>
            </div>
          </div>

          {/* Auto-read */}
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4 text-muted-foreground" /> Auto-Read Chat Responses
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoReadChat}
                onClick={() => onUpdateSetting("autoReadChat", !settings.autoReadChat)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${settings.autoReadChat ? "bg-primary" : "bg-input"}`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${settings.autoReadChat ? "translate-x-5" : "translate-x-0"}`}
                />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Automatically speak assistant messages aloud when they arrive.</p>
          </div>

          {/* Voice input language */}
          <div className="px-5 py-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Mic className="h-4 w-4 text-muted-foreground" /> Voice Input Language
            </label>
            <select
              value={settings.voiceInputLang}
              onChange={(e) => onUpdateSetting("voiceInputLang", e.target.value)}
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Tutor language */}
          <div className="px-5 py-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-muted-foreground" /> Tutor Response Language
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              The AI tutor will respond in this language. Technical terms are preserved via Custom Terminology.
            </p>
            <select
              value={user.preferred_language ?? "en"}
              onChange={(e) => {
                const lang = e.target.value;
                onUpdateProfile({ preferred_language: lang });
                updateUserProfile(user.id, { preferred_language: lang }).catch((err) =>
                  console.error("SettingsPage: failed to update language:", err)
                );
              }}
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese (Simplified)</option>
              <option value="pt">Portuguese</option>
              <option value="ko">Korean</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
              <option value="it">Italian</option>
              <option value="ru">Russian</option>
              <option value="tr">Turkish</option>
              <option value="vi">Vietnamese</option>
              <option value="nl">Dutch</option>
              <option value="pl">Polish</option>
              <option value="th">Thai</option>
              <option value="id">Indonesian</option>
              <option value="sw">Swahili</option>
            </select>
          </div>
        </div>
      </section>

      <div className="h-12" />
    </div>
  );
}

export { AvatarPreview, parseAvatar, randomAvatar };
