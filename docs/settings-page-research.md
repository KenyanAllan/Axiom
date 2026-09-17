# Settings Page — Research & Implementation Plan

## Current State

Axiom has a **non-functional Settings button** in the NavPanel (lucide `Settings` icon, no `onClick`). There is no settings page, no stored user preferences, and no backend settings table. The app uses Tailwind CSS variable-based theming (`bg-background`, `text-foreground`) but has no dark/light toggle wired up.

**User model fields today:** `id`, `display_name`, `role` (student | teacher | individual_learner), `xp`, `level`, `streak_days`. Backend also has `email` and `hashed_password` (both nullable). No avatar, bio, or preferences.

---

## Proposed Settings Categories

### 1. Profile Settings
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Display Name | Edit current name | **Low** | Frontend localStorage update + backend PATCH `/api/users/me` |
| Email | Add/change email | **Low** | Backend column exists, just needs UI + validation |
| Avatar/Initials | Upload image or pick color | **Medium** | Need storage (S3 or local), fallback to initials already used |
| Role Switch | Switch between student/teacher view | **Low** | Already have role logic throughout; just need a selector |
| Password | Set/change password | **Medium** | Backend has `hashed_password`; need bcrypt + confirm flow |

**Estimated total: 1–2 days**

---

### 2. Appearance
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Dark / Light / System theme | Toggle CSS variables | **Low** | Tailwind already supports `dark:` variants; need a `ThemeProvider` + `class` toggle on `<html>`. Store in localStorage. ~30 min. |
| Font size (Small / Default / Large) | Scale base font | **Low** | CSS variable `--font-scale` on root. ~20 min. |
| Compact mode | Reduce padding/spacing | **Low** | CSS class toggle. ~30 min. |

**Estimated total: 2–4 hours**

---

### 3. Learning Preferences
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Default activity types | Toggle which types appear in feed (e.g., disable "Wrong on Purpose") | **Medium** | Filter on `ACTIVITY_RENDERERS` keys. Need backend persistence for cross-session. |
| Flashcard deck size | Default 5/10/15 cards | **Low** | Frontend preference, pass to generation endpoint |
| Quiz length | Default 1–10 questions | **Low** | Same approach as deck size |
| Auto-advance flashcards | Toggle whether card auto-advances after assessment | **Low** | Boolean preference, already have the logic |
| Show XP | Toggle XP badges visibility | **Low** | CSS toggle on `.text-xp` elements |
| Difficulty level | Easy / Medium / Hard — affects generated content | **Medium** | Needs backend parameter on activity generation endpoints |

**Estimated total: 1–2 days**

---

### 4. Audio & Voice
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Text-to-speech voice | Pick from `speechSynthesis.getVoices()` | **Low** | Browser API, store preference in localStorage. ~30 min. |
| TTS speed | Slider 0.5x–2x | **Low** | Already have `utter.rate = 0.95`; make configurable. ~15 min. |
| Use AWS Polly vs browser TTS | Toggle backend Polly service | **Medium** | Backend `/api/audio` route exists; need UI toggle + fallback logic |
| Voice input language | Set recognition language for mic input | **Low** | `recognition.lang` parameter. ~15 min. |
| Auto-read chat responses | Toggle auto-TTS on assistant messages | **Low** | Boolean preference + `useEffect` on new messages. ~30 min. |

**Estimated total: 3–6 hours**

---

### 5. Notifications & Activity
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Daily reminder | Enable push/email reminder to study | **High** | Needs service worker (push) or email service (SendGrid/SES). Full notification pipeline. |
| Streak alerts | Toast when streak is at risk | **Medium** | Need `streak_days` tracking + toast component |
| Activity completion sounds | Play sound on XP earn | **Low** | `new Audio('/sounds/xp.mp3').play()`. ~15 min. |

**Estimated total: 1–3 days** (mostly the push notification pipeline)

---

### 6. Privacy & Data
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Export my data | Download all activities, chat, wiki as JSON/CSV | **Medium** | Backend aggregation endpoint + frontend download trigger |
| Delete account | Remove all user data | **Medium** | Cascade delete across tables + confirmation modal |
| Chat history retention | Auto-delete after N days | **Medium** | Backend cron/TTL + setting storage |

**Estimated total: 1–2 days**

---

### 7. Teacher-Only Settings
| Setting | Description | Complexity | Notes |
|---------|-------------|------------|-------|
| Classroom management | Invite/remove students, set class name | **Medium** | Backend `/api/classrooms` already exists; needs UI |
| Activity generation controls | Restrict which activity types students can generate | **Medium** | Backend flag per classroom |
| Student progress visibility | Toggle whether students see class leaderboard | **Low** | Boolean per classroom |
| Source doc approval | Require teacher approval before docs enter the knowledge graph | **High** | Approval queue workflow, backend state machine |

**Estimated total: 2–4 days**

---

## Complexity Summary

| Category | Effort | Priority for Hackathon |
|----------|--------|----------------------|
| Profile Settings | 1–2 days | Medium |
| **Appearance (dark mode)** | **2–4 hours** | **High — visible, easy win** |
| **Learning Preferences** | **1–2 days** | **High — core UX** |
| **Audio & Voice** | **3–6 hours** | **High — already half-built** |
| Notifications | 1–3 days | Low |
| Privacy & Data | 1–2 days | Low |
| Teacher-Only | 2–4 days | Medium |

---

## Recommended Hackathon Scope

For a hackathon demo, focus on what's **visible and impressive in 2 minutes**:

1. **Dark mode toggle** (~30 min) — instant visual impact in a demo
2. **TTS voice & speed selector** (~1 hour) — already have TTS; making it configurable shows polish
3. **Default deck size / quiz length** (~1 hour) — demonstrates customization
4. **Profile name edit** (~30 min) — shows the settings page is real, not a stub

This gives a functional 4-section settings page in **~3–4 hours** that covers Appearance, Audio, Learning, and Profile.

---

## Implementation Notes

**Frontend storage:** For the hackathon, `localStorage` is fine for all preferences. A `useSettings()` hook that reads/writes a `axiom_settings` key mirrors the existing `useDemoUser()` pattern.

**Backend persistence (post-hackathon):** Add a `user_preferences JSONB` column to the `User` table, with `GET/PATCH /api/users/me/preferences`. This avoids a separate settings table and keeps it flexible.

**Settings page location:** Wire the existing Settings button in NavPanel to a new `"settings"` ViewTab rendered in CenterStage, consistent with the existing tab pattern.
