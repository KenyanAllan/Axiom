"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Boxes,
  Users,
  ChevronLeft,
  ChevronRight,
  X,
  XCircle,
  Plus,
  Layers,
  CheckCircle2,
  ToggleLeft,
  PenLine,
  Drama,
  Headphones,
  Send,
  Loader2,
  RotateCcw,
  Eye,
  EyeOff,
  Mic,
  MicOff,
  Bot,
  MessageSquare,
  Play,
  Pause,
} from "lucide-react";
import { evaluateResponse, submitAttempt, generateAudioOverview } from "@/lib/api";
import type { WikiPage } from "@/components/layout/CenterStage";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivityType =
  | "flashcard"
  | "quiz"
  | "wrong_on_purpose"
  | "scenario"
  | "feynman"
  | "mini_podcast";

export type QuizQuestionType =
  | "multi_choice"
  | "true_false"
  | "short_answer"
  | "fill_blank";

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  topic: string;
  xp: number;
  payload?: Record<string, any>;
  lastResponse?: string;
  lastFeedback?: { is_correct: boolean; feedback: string };
  lastSelectedIndex?: number;
  lastAnswer?: boolean;
}

let _activityCounter = 100;

// ── Demo data ────────────────────────────────────────────────────────────────

export const INITIAL_ACTIVITIES: Activity[] = [
  {
    id: "act_fc_1",
    type: "flashcard",
    title: "Row Reduction Essentials",
    topic: "Row Reduction & Echelon Forms",
    xp: 25,
    payload: {
      cards: [
        { front: "What is the goal of Gaussian Elimination?", back: "To transform a system of linear equations into row echelon form using elementary row operations, making it easy to solve via back substitution." },
        { front: "What are the three elementary row operations?", back: "1) Swap two rows. 2) Multiply a row by a nonzero scalar. 3) Add a scalar multiple of one row to another." },
        { front: "What is the difference between REF and RREF?", back: "REF (Row Echelon Form) has zeros below each pivot. RREF (Reduced REF) additionally has zeros above each pivot and all pivots equal to 1. REF is not unique; RREF is." },
        { front: "What does it mean for a matrix to have a pivot in every column?", back: "The system has a unique solution — there are no free variables." },
        { front: "What is partial pivoting?", back: "Selecting the largest absolute value in the current column as the pivot element to minimize floating-point error amplification." },
      ],
    },
  },
  {
    id: "act_quiz_1",
    type: "quiz",
    title: "Row Reduction & Echelon Forms Quiz",
    topic: "Row Reduction & Echelon Forms",
    xp: 60,
    payload: {
      questions: [
        {
          type: "multi_choice",
          question: "Which of the following is NOT an elementary row operation?",
          options: ["Swap two rows", "Multiply a row by a nonzero scalar", "Multiply two rows together", "Add a scalar multiple of one row to another"],
          correct_index: 2,
        },
        {
          type: "true_false",
          statement: "Every matrix has a unique row echelon form.",
          correct_answer: false,
          explanation: "Row echelon form is NOT unique — a matrix can have many row echelon forms. However, the reduced row echelon form (RREF) IS unique.",
        },
        {
          type: "fill_blank",
          sentence: "A matrix is in row echelon form when all ___ rows are at the bottom and each leading entry is to the ___ of the one above.",
          blanks: ["zero", "right"],
        },
        {
          type: "short_answer",
          prompt: "Describe in 2–3 sentences how back substitution works once a system is in row echelon form.",
        },
        {
          type: "multi_choice",
          question: "If a 3×4 augmented matrix has pivots in columns 1, 2, and 3, the system has:",
          options: ["No solution", "Exactly one solution", "Infinitely many solutions", "Cannot be determined"],
          correct_index: 1,
        },
      ],
    },
  },
  {
    id: "act_wop_1",
    type: "wrong_on_purpose",
    title: "Spot the Flaw: Symmetric Matrix Claim",
    topic: "Matrix Properties",
    xp: 75,
    payload: {
      claim:
        "I hypothesize that multiplying matrix A by its transpose Aᵀ will always produce an identity matrix if A is symmetric.",
      flawed_snippet: `# Validate hypothesis with counterexample\nassert (A @ A.T == np.eye(n)).all(), "Counterexample:\\nA = [[2, 1], [1, 2]]"`,
      prompt: "Identify the false premise in this reasoning.",
    },
  },
  {
    id: "act_sc_1",
    type: "scenario",
    title: "Network Flow Optimization",
    topic: "Applications of Linear Algebra",
    xp: 100,
    payload: {
      scenario:
        "A water utility manages a network of 4 treatment plants connected by pipes with known capacities. They need to deliver 500 gallons/hour to a new district. The flow through each pipe is constrained by linear equations based on conservation at each junction.",
      question:
        "Set up the system of linear equations for flow conservation at each junction node. What method would you use to determine if the network can meet the demand?",
    },
  },
  {
    id: "act_fy_1",
    type: "feynman",
    title: "Teach: Elementary Row Operations",
    topic: "Row Reduction & Echelon Forms",
    xp: 50,
    payload: {
      concept: "Elementary Row Operations",
      prompt:
        "Explain in your own words why elementary row operations do not change the solution set of a system of linear equations. Use an analogy if it helps.",
    },
  },
  {
    id: "act_ao_1",
    type: "mini_podcast",
    title: "Mini Podcast: Determinants",
    topic: "Determinants",
    xp: 40,
    payload: {
      summary:
        "The determinant is a scalar value computed from a square matrix that encodes key geometric and algebraic properties. A nonzero determinant means the matrix is invertible, the columns are linearly independent, and the associated transformation preserves dimension. The determinant can be computed via cofactor expansion along any row or column, or by reducing to triangular form and multiplying the diagonal entries.",
      question:
        "After listening, explain: what does a zero determinant tell you about the column vectors of the matrix?",
    },
  },
];

// ── Type config ──────────────────────────────────────────────────────────────

const DEFAULT_TYPE_CONFIG = {
  label: "Activity",
  icon: Boxes,
  color: "text-gray-500",
  bg: "bg-gray-50",
};

export const TYPE_CONFIG: Partial<Record<
  ActivityType,
  { label: string; icon: any; color: string; bg: string }
>> = {
  flashcard: {
    label: "Flashcard Deck",
    icon: Layers,
    color: "text-sky-500",
    bg: "bg-sky-50",
  },
  quiz: {
    label: "Quiz",
    icon: CheckCircle2,
    color: "text-green-500",
    bg: "bg-green-50",
  },
  wrong_on_purpose: {
    label: "Wrong on Purpose",
    icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-50",
  },
  scenario: {
    label: "Scenario",
    icon: Drama,
    color: "text-rose-500",
    bg: "bg-rose-50",
  },
  feynman: {
    label: "Feynman",
    icon: Users,
    color: "text-purple-500",
    bg: "bg-purple-50",
  },
  mini_podcast: {
    label: "Mini Podcast",
    icon: Headphones,
    color: "text-teal-500",
    bg: "bg-teal-50",
  },
};

export function getTypeConfig(type: ActivityType) {
  return TYPE_CONFIG[type] ?? DEFAULT_TYPE_CONFIG;
}

export const XP_BY_TYPE: Partial<Record<ActivityType, number>> = {
  flashcard: 25,
  quiz: 60,
  wrong_on_purpose: 75,
  scenario: 100,
  feynman: 50,
  mini_podcast: 40,
};

const DEFAULT_XP = 30;

// ── Collapsed list view ──────────────────────────────────────────────────────

interface ActivityFeedProps {
  activities: Activity[];
  onActivitiesChange: (activities: Activity[]) => void;
  onExpandActivity: (id: string) => void;
  wikiPages: WikiPage[];
  userId: string;
}

export function ActivityFeed({
  activities,
  onActivitiesChange,
  onExpandActivity,
  wikiPages,
  userId,
}: ActivityFeedProps) {
  const [showForm, setShowForm] = useState(false);
  const [fTitle, setFTitle] = useState("");
  const [fTopic, setFTopic] = useState("");
  const [fType, setFType] = useState<ActivityType>("flashcard");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [fStyle, setFStyle] = useState<"conversational" | "narrative" | "discussion">("conversational");
  const [fUserInstruction, setFUserInstruction] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const formInputCls =
    "w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  // Build suggestion list: "All", wiki page titles, all claim titles
  const allClaimTitles = wikiPages.flatMap((p) =>
    p.claims.map((c) => c.title)
  );
  const suggestions: { label: string; value: string; type: "all" | "page" | "claim" }[] = [
    { label: "All (every page & claim)", value: "__ALL__", type: "all" },
    ...wikiPages.map((p) => ({ label: p.title, value: p.title, type: "page" as const })),
    ...wikiPages.flatMap((p) =>
      p.claims.map((c) => ({
        label: c.title,
        value: c.title,
        type: "claim" as const,
      }))
    ),
  ];

  const filteredSuggestions = fTopic.trim()
    ? suggestions.filter(
        (s) =>
          s.type === "all" ||
          s.label.toLowerCase().includes(fTopic.toLowerCase())
      )
    : suggestions;

  const handleSelectTopic = (s: (typeof suggestions)[0]) => {
    if (s.type === "all") {
      const allTitles = [
        ...wikiPages.map((p) => p.title),
        ...allClaimTitles,
      ];
      setFTopic(allTitles.join(", "));
    } else if (s.type === "page") {
      const page = wikiPages.find((p) => p.title === s.value);
      if (page) {
        const parts = [page.title, ...page.claims.map((c) => c.title)];
        setFTopic(parts.join(", "));
      }
    } else {
      setFTopic((prev) => {
        const existing = prev
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (existing.includes(s.value)) return prev;
        return [...existing, s.value].join(", ");
      });
    }
    setShowSuggestions(false);
  };

  const handleCreate = async () => {
    if (!fTitle.trim() || !fTopic.trim()) return;

    if (fType === "mini_podcast") {
      const topicIds = selectedTopicIds.length > 0
        ? selectedTopicIds
        : wikiPages
            .filter((p) => fTopic.toLowerCase().includes(p.title.toLowerCase()))
            .map((p) => p.id);

      if (topicIds.length === 0) {
        const fallback: Activity = {
          id: `activity_${++_activityCounter}`,
          type: "mini_podcast",
          title: fTitle.trim(),
          topic: fTopic.trim(),
          xp: XP_BY_TYPE.mini_podcast ?? 40,
        };
        onActivitiesChange([fallback, ...activities]);
        resetForm();
        return;
      }

      setIsGenerating(true);
      try {
        const result = await generateAudioOverview(userId, {
          topic_ids: topicIds,
          style: fStyle,
          user_instruction: fUserInstruction.trim() || undefined,
        });
        const newActivity: Activity = {
          id: String(result.activity_id),
          type: "mini_podcast",
          title: result.title,
          topic: fTopic.trim(),
          xp: XP_BY_TYPE.mini_podcast ?? 40,
          payload: {
            summary: result.script,
            question: result.question,
            audio_url: result.audio_url,
            s3_key: result.s3_key,
            style: result.style,
          },
        };
        onActivitiesChange([newActivity, ...activities]);
      } catch (err) {
        console.error("Audio overview generation failed:", err);
        const fallback: Activity = {
          id: `activity_${++_activityCounter}`,
          type: "mini_podcast",
          title: fTitle.trim(),
          topic: fTopic.trim(),
          xp: XP_BY_TYPE.mini_podcast ?? 40,
        };
        onActivitiesChange([fallback, ...activities]);
      } finally {
        setIsGenerating(false);
        resetForm();
      }
      return;
    }

    const newActivity: Activity = {
      id: `activity_${++_activityCounter}`,
      type: fType,
      title: fTitle.trim(),
      topic: fTopic.trim(),
      xp: XP_BY_TYPE[fType] ?? DEFAULT_XP,
    };
    onActivitiesChange([newActivity, ...activities]);
    resetForm();
  };

  const resetForm = () => {
    setFTitle("");
    setFTopic("");
    setFType("flashcard");
    setFStyle("conversational");
    setFUserInstruction("");
    setSelectedTopicIds([]);
    setShowForm(false);
  };

  const ALL_TYPES: ActivityType[] = [
    "flashcard",
    "quiz",
    "wrong_on_purpose",
    "scenario",
    "feynman",
    "mini_podcast",
  ];

  return (
    <div className="space-y-2 px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Activity Feed</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your pending learning activities. Click to expand.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Activity
          </button>
        )}
      </div>

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowForm(false)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowForm(false)}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="mb-4 text-lg font-bold">Create Activity</p>
            <div className="space-y-4">
            <input
              className={formInputCls}
              placeholder="Activity title"
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              autoFocus
            />
            <div className="relative">
              <input
                className={formInputCls}
                placeholder="Topic — type to search wiki pages & claims"
                value={fTopic}
                onChange={(e) => {
                  setFTopic(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              />
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-md border bg-background shadow-lg">
                  {filteredSuggestions.map((s, i) => (
                    <button
                      key={`${s.type}-${i}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectTopic(s);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
                    >
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          s.type === "all"
                            ? "bg-primary/10 text-primary"
                            : s.type === "page"
                              ? "bg-sky-50 text-sky-600"
                              : "bg-amber-50 text-amber-600"
                        }`}
                      >
                        {s.type === "all"
                          ? "ALL"
                          : s.type === "page"
                            ? "Page"
                            : "Claim"}
                      </span>
                      <span className="truncate">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TYPES.map((t) => {
                const c = getTypeConfig(t);
                const Icon = c.icon;
                return (
                  <button
                    key={t}
                    onClick={() => setFType(t)}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      fType === t
                        ? `${c.bg} ${c.color} border-current`
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {c.label}
                  </button>
                );
              })}
            </div>
            {fType === "mini_podcast" && (
              <div className="space-y-3 rounded-lg border bg-secondary/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Audio Overview Settings
                </p>
                {/* Topic selection */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground/70">Select topics to include</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {wikiPages.map((page) => (
                      <label key={page.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTopicIds.includes(page.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTopicIds((prev) => [...prev, page.id]);
                            } else {
                              setSelectedTopicIds((prev) => prev.filter((id) => id !== page.id));
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                        <span>{page.title}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{page.claims.length} claims</span>
                      </label>
                    ))}
                  </div>
                </div>
                {/* Style selector */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground/70">Narration style</p>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { key: "conversational" as const, label: "Conversational", desc: "Casual study-buddy tone" },
                      { key: "narrative" as const, label: "Narrative", desc: "Documentary storytelling" },
                      { key: "discussion" as const, label: "Discussion", desc: "Two people talking it through" },
                    ]).map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setFStyle(s.key)}
                        className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${
                          fStyle === s.key
                            ? "border-teal-500 bg-teal-50 text-teal-700"
                            : "text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        <span className="text-xs font-medium">{s.label}</span>
                        <span className="text-[10px] opacity-70">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Custom instructions */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground/70">Custom instructions (optional)</p>
                  <textarea
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g., focus on examples, keep it under 2 minutes, explain like I'm 5..."
                    rows={2}
                    maxLength={500}
                    value={fUserInstruction}
                    onChange={(e) => setFUserInstruction(e.target.value)}
                  />
                  <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{fUserInstruction.length}/500</p>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { resetForm(); }}
                className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                disabled={isGenerating}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!fTitle.trim() || !fTopic.trim() || isGenerating}
                className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {isGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isGenerating ? "Generating..." : fType === "mini_podcast" ? "Generate Audio" : "Create"}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {activities.map((activity) => {
        const config = getTypeConfig(activity.type);
        const Icon = config.icon;
        return (
          <button
            key={activity.id}
            onClick={() => onExpandActivity(activity.id)}
            className="flex w-full items-center gap-4 rounded-lg border bg-card px-5 py-4 text-left transition-all hover:bg-accent/30 hover:shadow-sm"
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${config.bg}`}
            >
              <Icon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {activity.title}
                </p>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${config.bg} ${config.color}`}
                >
                  {config.label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {activity.topic}
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs font-semibold text-xp">
              +{activity.xp} XP
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        );
      })}

      {activities.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No activities yet. Click &quot;New Activity&quot; to create one.
        </p>
      )}
    </div>
  );
}

// ── Shared helpers for overlay ───────────────────────────────────────────────

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

interface FeedbackState {
  is_correct: boolean;
  feedback: string;
}

async function callEvaluate(
  activityId: string,
  studentResponse: string
): Promise<FeedbackState | null> {
  // 1. Try the attempt endpoint (works when activityId is a numeric backend ID)
  const numericId = Number(activityId);
  if (!isNaN(numericId) && Number.isInteger(numericId)) {
    try {
      const data = await submitAttempt("usr_student_demo", {
        activity_id: numericId,
        student_response: studentResponse,
      });
      return {
        is_correct: data.outcome === "understood",
        feedback: data.feedback,
      };
    } catch (err) {
      console.error("ActivityFeed: submitAttempt failed, falling back to evaluate:", err);
    }
  }

  // 2. Try the evaluate endpoint (works with claim_id strings)
  try {
    const data = await evaluateResponse("usr_student_demo", {
      claim_id: activityId,
      student_response: studentResponse,
    });
    return {
      is_correct: data.outcome === "understood",
      feedback: data.feedback,
    };
  } catch (err) {
    console.error("ActivityFeed: evaluateResponse failed, using fallback:", err);
    return null;
  }
}

function FeedbackBanner({
  feedback,
  activityTitle,
  onDiscussWithTutor,
}: {
  feedback: FeedbackState;
  activityTitle?: string;
  onDiscussWithTutor?: (context: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-primary">Axiom AI</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                feedback.is_correct
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {feedback.is_correct ? "Correct" : "Review needed"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">
            {feedback.feedback}
          </p>
          {onDiscussWithTutor && (
            <button
              onClick={() => {
                const context = feedback.is_correct
                  ? `I just completed the activity "${activityTitle ?? "an activity"}" correctly. Can you help me deepen my understanding? Here's the feedback I received:\n\n"${feedback.feedback}"`
                  : `I just attempted the activity "${activityTitle ?? "an activity"}" and got it wrong. Here's the feedback I received:\n\n"${feedback.feedback}"\n\nCan you help me understand what I got wrong and explain the correct answer?`;
                onDiscussWithTutor(context);
              }}
              className="mt-3 flex items-center gap-2 rounded-md border border-primary/30 bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Discuss in Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoiceMicButton({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  const toggle = useCallback(() => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    try {
      const SR =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (!SR) return;
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";
      rec.onresult = (e: any) => {
        onTranscript(e.results[0][0].transcript);
        setListening(false);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch (err) {
      console.warn("ActivityFeed: speech recognition not supported:", err);
    }
  }, [listening, onTranscript]);

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
        listening
          ? "animate-pulse bg-red-500 text-white"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      title={listening ? "Stop listening" : "Voice input"}
      type="button"
    >
      {listening ? (
        <MicOff className="h-3.5 w-3.5" />
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function SubmitRow({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder: string;
  multiline?: boolean;
}) {
  const handleTranscript = useCallback(
    (text: string) => {
      onChange(value + (value ? " " : "") + text);
    },
    [value, onChange]
  );

  if (multiline) {
    return (
      <div className="space-y-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} min-h-[100px] resize-none`}
          rows={4}
          disabled={isLoading}
        />
        <div className="flex items-center justify-end gap-2">
          <VoiceMicButton onTranscript={handleTranscript} disabled={isLoading} />
          <button
            onClick={onSubmit}
            disabled={!value.trim() || isLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Submit
                <Send className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={placeholder}
        className={inputCls}
        disabled={isLoading}
      />
      <VoiceMicButton onTranscript={handleTranscript} disabled={isLoading} />
      <button
        onClick={onSubmit}
        disabled={!value.trim() || isLoading}
        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Submit
            <Send className="h-3.5 w-3.5" />
          </>
        )}
      </button>
    </div>
  );
}

// ── Per-type activity cards ──────────────────────────────────────────────────

interface RendererProps {
  activity: Activity;
  onDiscussWithTutor?: (context: string) => void;
  onSaveResult?: (result: { lastResponse: string; lastFeedback?: FeedbackState }) => void;
}

// ── Flashcard Deck ──────────────────────────────────────────────────────────

type FlashCard = { front: string; back: string };
type FlashAssessment = "knew" | "learning" | null;

function FlashcardDeckActivity({ activity, onSaveResult }: RendererProps) {
  const cards: FlashCard[] = (() => {
    const p = activity.payload ?? {};
    if (Array.isArray(p.cards) && p.cards.length > 0) return p.cards as FlashCard[];
    return [{ front: (p.front as string) ?? activity.title, back: (p.back as string) ?? "No answer provided." }];
  })();

  const savedAssessments: FlashAssessment[] | null = (() => {
    if (!activity.lastResponse) return null;
    try {
      const parsed = JSON.parse(activity.lastResponse);
      if (Array.isArray(parsed) && parsed.length === cards.length) return parsed as FlashAssessment[];
    } catch (err) { console.warn("ActivityFeed: failed to parse saved flashcard assessments:", err); }
    return null;
  })();

  const [revealed, setRevealed] = useState<boolean[]>(() => new Array(cards.length).fill(false));
  const [assessments, setAssessments] = useState<FlashAssessment[]>(() => savedAssessments ?? new Array(cards.length).fill(null));
  const [showSummary, setShowSummary] = useState(
    () => savedAssessments !== null && savedAssessments.every((a) => a !== null),
  );

  const savedIndex = savedAssessments ? savedAssessments.findIndex((a) => a === null) : -1;
  const [currentIndex, setCurrentIndex] = useState(() =>
    savedIndex >= 0 ? savedIndex : 0,
  );

  const totalCount = cards.length;
  const knewCount = assessments.filter((a) => a === "knew").length;
  const learningCount = assessments.filter((a) => a === "learning").length;

  const handleReveal = () => {
    setRevealed((prev) => { const next = [...prev]; next[currentIndex] = true; return next; });
  };
  const handleHide = () => {
    setRevealed((prev) => { const next = [...prev]; next[currentIndex] = false; return next; });
  };

  const handleAssess = (value: "knew" | "learning") => {
    const next = [...assessments];
    next[currentIndex] = value;
    setAssessments(next);
    if (next.every((a) => a !== null)) {
      const knew = next.filter((a) => a === "knew").length;
      onSaveResult?.({ lastResponse: JSON.stringify(next), lastFeedback: { is_correct: knew > totalCount / 2, feedback: `${knew}/${totalCount} cards mastered` } });
      setShowSummary(true);
    } else {
      onSaveResult?.({ lastResponse: JSON.stringify(next) });
      if (currentIndex < totalCount - 1) {
        setCurrentIndex((i) => i + 1);
      }
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setRevealed(new Array(cards.length).fill(false));
    setAssessments(new Array(cards.length).fill(null));
    setShowSummary(false);
  };

  if (showSummary) {
    const pct = totalCount > 0 ? Math.round((knewCount / totalCount) * 100) : 0;
    return (
      <div className="space-y-5">
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-3xl font-bold tracking-tight">{pct}%</p>
          <p className="mt-1 text-sm text-muted-foreground">Cards mastered</p>
          <div className="mx-auto mt-4 flex max-w-xs items-center justify-center gap-6 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" />{knewCount} knew</span>
            <span className="flex items-center gap-1.5 text-amber-600"><RotateCcw className="h-4 w-4" />{learningCount} learning</span>
          </div>
          <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button onClick={handleRestart} className="mx-auto flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
          <RotateCcw className="h-3.5 w-3.5" />Study again
        </button>
      </div>
    );
  }

  const card = cards[currentIndex];
  const isRevealed = revealed[currentIndex];
  const assessment = assessments[currentIndex];
  const progressPct = ((currentIndex + 1) / totalCount) * 100;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Card {currentIndex + 1} of {totalCount}</span>
          <span>{assessments.filter((a) => a !== null).length} assessed</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
      <div className="rounded-lg border bg-secondary/20 p-5 transition-all">
        <p className="text-center text-sm font-medium leading-relaxed">{card.front}</p>
      </div>
      {!isRevealed ? (
        <button onClick={handleReveal} className="mx-auto flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
          <Eye className="h-4 w-4" />Reveal Answer
        </button>
      ) : (
        <div className="space-y-3 transition-all">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-center text-sm leading-relaxed text-foreground/80">{card.back}</p>
          </div>
          <button onClick={handleHide} className="mx-auto flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent">
            <EyeOff className="h-3.5 w-3.5" />Hide
          </button>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => handleAssess("knew")} className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${assessment === "knew" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "text-emerald-600 hover:bg-emerald-50"}`}>
              <CheckCircle2 className="h-4 w-4" />I knew this
            </button>
            <button onClick={() => handleAssess("learning")} className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${assessment === "learning" ? "border-amber-300 bg-amber-50 text-amber-700" : "text-amber-600 hover:bg-amber-50"}`}>
              <RotateCcw className="h-4 w-4" />Still learning
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => setCurrentIndex((i) => i - 1)} disabled={currentIndex === 0} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" />Previous
        </button>
        <button onClick={() => setCurrentIndex((i) => i + 1)} disabled={currentIndex === totalCount - 1} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
          Next<ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Quiz Activity ───────────────────────────────────────────────────────────

type QuizQuestionDef =
  | { type: "multi_choice"; question: string; options: string[]; correct_index: number }
  | { type: "true_false"; statement: string; correct_answer: boolean; explanation?: string }
  | { type: "short_answer"; prompt: string }
  | { type: "fill_blank"; sentence: string; blanks: string[] };

function getQuestionText(q: QuizQuestionDef): string {
  switch (q.type) {
    case "multi_choice": return q.question;
    case "true_false": return q.statement;
    case "short_answer": return q.prompt;
    case "fill_blank": return q.sentence;
  }
}

function gradeQuestion(q: QuizQuestionDef, answer: any): { correct: boolean; needsReview: boolean } {
  switch (q.type) {
    case "multi_choice": return { correct: answer === q.correct_index, needsReview: false };
    case "true_false": return { correct: answer === q.correct_answer, needsReview: false };
    case "short_answer": return { correct: false, needsReview: true };
    case "fill_blank": {
      const student: string[] = answer ?? [];
      return { correct: q.blanks.every((b, i) => (student[i] ?? "").trim().toLowerCase() === b.trim().toLowerCase()), needsReview: false };
    }
  }
}

function QuizMCRenderer({ question, answer, onChange }: { question: Extract<QuizQuestionDef, { type: "multi_choice" }>; answer: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium leading-relaxed">{question.question}</p>
      <div className="space-y-2">
        {question.options.map((opt, i) => (
          <button key={i} onClick={() => onChange(i)} className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${answer === i ? "border-primary bg-primary/5" : "hover:bg-accent/30"}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${answer === i ? "border-primary bg-primary text-primary-foreground" : ""}`}>{String.fromCharCode(65 + i)}</span>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuizTFRenderer({ question, answer, onChange }: { question: Extract<QuizQuestionDef, { type: "true_false" }>; answer: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-secondary/20 p-5">
        <p className="text-center text-sm font-medium leading-relaxed">{question.statement}</p>
      </div>
      <div className="flex justify-center gap-4">
        {[true, false].map((val) => (
          <button key={String(val)} onClick={() => onChange(val)} className={`rounded-lg border px-8 py-3 text-sm font-semibold transition-colors ${answer === val ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent/30"}`}>
            {val ? "True" : "False"}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuizSARenderer({ question, answer, onChange }: { question: Extract<QuizQuestionDef, { type: "short_answer" }>; answer: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium leading-relaxed">{question.prompt}</p>
      <textarea value={answer ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="Type your answer..." className={`${inputCls} min-h-[100px] resize-none`} rows={4} />
    </div>
  );
}

function QuizFBRenderer({ question, answer, onChange }: { question: Extract<QuizQuestionDef, { type: "fill_blank" }>; answer: string[] | undefined; onChange: (v: string[]) => void }) {
  const blanks = answer ?? question.blanks.map(() => "");
  const parts = question.sentence.split("___");
  const updateBlank = (idx: number, val: string) => { const next = [...blanks]; next[idx] = val; onChange(next); };
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed">
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <input type="text" value={blanks[i] ?? ""} onChange={(e) => updateBlank(i, e.target.value)} className="mx-1 inline-block w-[120px] border-b-2 border-primary/40 bg-transparent px-1 py-0.5 text-center text-sm font-medium focus:border-primary focus:outline-none" placeholder={`blank ${i + 1}`} />
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

function QuizProgressDots({ total, current, answered }: { total: number; current: number; answered: Record<number, any> }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => {
        const isAnswered = answered[i] !== undefined;
        const isCurrent = i === current;
        return <span key={i} className={`h-2.5 w-2.5 rounded-full transition-all ${isCurrent ? "ring-2 ring-primary ring-offset-2 ring-offset-background " + (isAnswered ? "bg-primary" : "bg-primary/30") : isAnswered ? "bg-primary" : "border border-muted-foreground/30 bg-transparent"}`} />;
      })}
    </div>
  );
}

function formatStudentAnswer(q: QuizQuestionDef, answer: any): string | null {
  if (answer === undefined || answer === null) return null;
  switch (q.type) {
    case "multi_choice": return typeof answer === "number" ? `${String.fromCharCode(65 + answer)}) ${q.options[answer] ?? ""}` : null;
    case "true_false": return typeof answer === "boolean" ? (answer ? "True" : "False") : null;
    case "short_answer": return typeof answer === "string" && answer.trim() ? answer : null;
    case "fill_blank": return Array.isArray(answer) ? answer.join(", ") : null;
  }
}

function formatCorrectAnswer(q: QuizQuestionDef): string | null {
  switch (q.type) {
    case "multi_choice": return `${String.fromCharCode(65 + q.correct_index)}) ${q.options[q.correct_index]}`;
    case "true_false": return q.correct_answer ? "True" : "False";
    case "short_answer": return null;
    case "fill_blank": return q.blanks.join(", ");
  }
}

function QuizScoreSummary({ questions, answers, score, total, activityTitle, onDiscussWithTutor }: { questions: QuizQuestionDef[]; answers: Record<number, any>; score: number; total: number; activityTitle: string; onDiscussWithTutor?: (ctx: string) => void }) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = score > total / 2;
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-6 py-6">
        <div className={`text-4xl font-bold ${passed ? "text-emerald-600" : "text-amber-600"}`}>{score}/{total}</div>
        <p className="text-sm text-muted-foreground">{pct}% correct</p>
        <span className={`mt-1 rounded-full px-3 py-1 text-xs font-medium ${passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{passed ? "Passed" : "Needs improvement"}</span>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3"><p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Question Breakdown</p></div>
        <div className="divide-y">
          {questions.map((q, i) => {
            const result = gradeQuestion(q, answers[i]);
            const text = getQuestionText(q);
            const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
            const studentAnswer = formatStudentAnswer(q, answers[i]);
            const correctAnswer = formatCorrectAnswer(q);
            return (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {result.needsReview ? <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" /> : result.correct ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{preview}</p>
                    <p className="text-xs text-muted-foreground">{q.type === "multi_choice" ? "Multiple Choice" : q.type === "true_false" ? "True / False" : q.type === "short_answer" ? "Short Answer" : "Fill in the Blank"}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${result.needsReview ? "text-amber-600" : result.correct ? "text-emerald-600" : "text-red-600"}`}>{result.needsReview ? "Needs review" : result.correct ? "Correct" : "Incorrect"}</span>
                </div>
                {studentAnswer && (
                  <div className="ml-7 mt-2 space-y-1">
                    <p className="text-xs"><span className="font-medium text-muted-foreground">Your answer:</span> <span className={result.correct ? "text-emerald-700" : "text-red-700"}>{studentAnswer}</span></p>
                    {!result.correct && !result.needsReview && correctAnswer && (
                      <p className="text-xs"><span className="font-medium text-muted-foreground">Correct answer:</span> <span className="text-emerald-700">{correctAnswer}</span></p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10"><Bot className="h-4 w-4 text-primary" /></div>
        <div className="min-w-0 flex-1 rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-primary">Axiom AI</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{passed ? "Good work" : "Keep practicing"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">
            {passed ? `Great job! You scored ${score}/${total} (${pct}%). ${score < total ? "Review the questions you missed to strengthen those areas." : "Perfect score!"}` : `You scored ${score}/${total} (${pct}%). Review the incorrect answers and try again.`}
          </p>
          {onDiscussWithTutor && (
            <button onClick={() => onDiscussWithTutor(passed ? `I completed "${activityTitle}" scoring ${score}/${total}. Help me review what I missed.` : `I scored ${score}/${total} on "${activityTitle}". Help me understand these concepts.`)} className="mt-3 flex items-center gap-2 rounded-md border border-primary/30 bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5">
              <MessageSquare className="h-3.5 w-3.5" />Discuss in Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizActivity({ activity, onDiscussWithTutor, onSaveResult }: RendererProps) {
  const questions: QuizQuestionDef[] = (activity.payload as any)?.questions ?? [];

  const restoredAnswers: Record<number, any> = (() => {
    if (!activity.lastResponse) return {};
    try { return JSON.parse(activity.lastResponse); } catch (err) { console.warn("ActivityFeed: failed to parse quiz answers:", err); return {}; }
  })();
  const isCompleted = !!activity.lastFeedback;

  const firstUnanswered = (() => {
    for (let i = 0; i < questions.length; i++) { if (restoredAnswers[i] === undefined) return i; }
    return 0;
  })();

  const [currentIndex, setCurrentIndex] = useState(isCompleted ? 0 : firstUnanswered);
  const [answers, setAnswers] = useState<Record<number, any>>(restoredAnswers);
  const [submitted, setSubmitted] = useState(isCompleted);

  if (questions.length === 0) return <div className="rounded-lg border bg-card px-5 py-8 text-center"><p className="text-sm text-muted-foreground">No questions found in this quiz.</p></div>;

  const question = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;

  const computeScore = () => {
    let s = 0;
    questions.forEach((q, i) => { const r = gradeQuestion(q, answers[i]); if (r.correct && !r.needsReview) s++; });
    return s;
  };

  const handleAnswer = (value: any) => {
    if (submitted) return;
    const updated = { ...answers, [currentIndex]: value };
    setAnswers(updated);
    onSaveResult?.({ lastResponse: JSON.stringify(updated) });
  };

  const handleSubmit = () => {
    setSubmitted(true);
    const score = computeScore();
    onSaveResult?.({ lastResponse: JSON.stringify(answers), lastFeedback: { is_correct: score > questions.length / 2, feedback: `${score}/${questions.length} correct` } });
  };

  if (submitted) {
    return <QuizScoreSummary questions={questions} answers={answers} score={computeScore()} total={questions.length} activityTitle={activity.title} onDiscussWithTutor={onDiscussWithTutor} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">Question {currentIndex + 1} of {questions.length}</p>
        <QuizProgressDots total={questions.length} current={currentIndex} answered={answers} />
      </div>
      <div className="rounded-lg border bg-card px-5 py-5">
        {question.type === "multi_choice" && <QuizMCRenderer question={question} answer={answers[currentIndex]} onChange={handleAnswer} />}
        {question.type === "true_false" && <QuizTFRenderer question={question} answer={answers[currentIndex]} onChange={handleAnswer} />}
        {question.type === "short_answer" && <QuizSARenderer question={question} answer={answers[currentIndex]} onChange={handleAnswer} />}
        {question.type === "fill_blank" && <QuizFBRenderer question={question} answer={answers[currentIndex]} onChange={handleAnswer} />}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={() => setCurrentIndex((i) => i - 1)} disabled={currentIndex === 0} className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" />Previous
        </button>
        {isLast ? (
          <button onClick={handleSubmit} className="flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90">
            Submit Quiz<Send className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button onClick={() => setCurrentIndex((i) => i + 1)} className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
            Next<ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function WrongOnPurposeActivity({ activity, onDiscussWithTutor, onSaveResult }: RendererProps) {
  const [response, setResponse] = useState(activity.lastResponse ?? "");
  const [feedback, setFeedback] = useState<FeedbackState | null>(activity.lastFeedback ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};
  const draftRef = useRef(response);
  draftRef.current = response;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  useEffect(() => () => { if (draftRef.current.trim() && !feedbackRef.current) onSaveResult?.({ lastResponse: draftRef.current }); }, [onSaveResult]);

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const result = await callEvaluate(activity.id, response);
      if (result) {
        setFeedback(result);
        onSaveResult?.({ lastResponse: response, lastFeedback: result });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        const isCorrect = response.trim().length > 30;
        const fb = {
          is_correct: isCorrect,
          feedback: isCorrect
            ? "Good catch! You correctly identified the flaw in the reasoning."
            : "Not quite. Look more carefully at the assumptions being made.",
        };
        setFeedback(fb);
        onSaveResult?.({ lastResponse: response, lastFeedback: fb });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm italic leading-relaxed text-amber-900">
          &ldquo;{p.claim ?? activity.title}&rdquo;
        </p>
      </div>
      {p.flawed_snippet && (
        <div className="code-block">
          <div className="filename">
            <span className="font-mono">diagnostic_test.py</span>
            <span>Python 3.11</span>
          </div>
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
            {p.flawed_snippet}
          </pre>
        </div>
      )}
      {p.prompt && (
        <p className="text-sm text-foreground/80">{p.prompt}</p>
      )}
      {!feedback ? (
        <SubmitRow
          value={response}
          onChange={setResponse}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder="Identify the flaw..."
          multiline
        />
      ) : (
        <>
          {response && (
            <div className="rounded-lg border bg-secondary/20 px-4 py-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your Answer</p>
              <p className="text-sm leading-relaxed text-foreground/80">{response}</p>
            </div>
          )}
          <FeedbackBanner feedback={feedback} activityTitle={activity.title} onDiscussWithTutor={onDiscussWithTutor} />
        </>
      )}
    </div>
  );
}

function ScenarioActivity({ activity, onDiscussWithTutor, onSaveResult }: RendererProps) {
  const [response, setResponse] = useState(activity.lastResponse ?? "");
  const [feedback, setFeedback] = useState<FeedbackState | null>(activity.lastFeedback ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};
  const draftRef = useRef(response);
  draftRef.current = response;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  useEffect(() => () => { if (draftRef.current.trim() && !feedbackRef.current) onSaveResult?.({ lastResponse: draftRef.current }); }, [onSaveResult]);

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const result = await callEvaluate(activity.id, response);
      if (result) {
        setFeedback(result);
        onSaveResult?.({ lastResponse: response, lastFeedback: result });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        const fb = {
          is_correct: response.trim().length > 40,
          feedback:
            response.trim().length > 40
              ? "Strong analysis! You've correctly applied the relevant concepts to this scenario."
              : "Try to be more thorough. Consider the constraints and how linear algebra applies here.",
        };
        setFeedback(fb);
        onSaveResult?.({ lastResponse: response, lastFeedback: fb });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-secondary/20 p-4">
        <p className="text-sm leading-relaxed text-foreground/80">
          {p.scenario}
        </p>
      </div>
      <p className="text-sm font-medium">{p.question ?? activity.title}</p>
      {!feedback ? (
        <SubmitRow
          value={response}
          onChange={setResponse}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder="Write your analysis..."
          multiline
        />
      ) : (
        <>
          {response && (
            <div className="rounded-lg border bg-secondary/20 px-4 py-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your Answer</p>
              <p className="text-sm leading-relaxed text-foreground/80">{response}</p>
            </div>
          )}
          <FeedbackBanner feedback={feedback} activityTitle={activity.title} onDiscussWithTutor={onDiscussWithTutor} />
        </>
      )}
    </div>
  );
}

function FeynmanActivity({ activity, onDiscussWithTutor, onSaveResult }: RendererProps) {
  const [response, setResponse] = useState(activity.lastResponse ?? "");
  const [feedback, setFeedback] = useState<FeedbackState | null>(activity.lastFeedback ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};
  const draftRef = useRef(response);
  draftRef.current = response;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  useEffect(() => () => { if (draftRef.current.trim() && !feedbackRef.current) onSaveResult?.({ lastResponse: draftRef.current }); }, [onSaveResult]);

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const result = await callEvaluate(activity.id, response);
      if (result) {
        setFeedback(result);
        onSaveResult?.({ lastResponse: response, lastFeedback: result });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        const fb = {
          is_correct: response.trim().length > 30,
          feedback:
            response.trim().length > 30
              ? "Great explanation! You demonstrate a solid grasp of the concept."
              : "Your explanation is a bit brief. Try to explain it as if teaching someone who has never seen this before.",
        };
        setFeedback(fb);
        onSaveResult?.({ lastResponse: response, lastFeedback: fb });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
        <Users className="h-5 w-5 shrink-0 text-purple-500" />
        <div>
          <p className="text-sm font-semibold text-purple-900">
            Feynman Technique
          </p>
          <p className="text-xs text-purple-700">
            Explain <span className="font-semibold">{p.concept ?? activity.topic}</span> in your own words
          </p>
        </div>
      </div>
      {p.prompt && (
        <p className="text-sm text-foreground/80">{p.prompt}</p>
      )}
      {!feedback ? (
        <SubmitRow
          value={response}
          onChange={setResponse}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder="Explain the concept in plain language..."
          multiline
        />
      ) : (
        <>
          {response && (
            <div className="rounded-lg border bg-secondary/20 px-4 py-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your Answer</p>
              <p className="text-sm leading-relaxed text-foreground/80">{response}</p>
            </div>
          )}
          <FeedbackBanner feedback={feedback} activityTitle={activity.title} onDiscussWithTutor={onDiscussWithTutor} />
        </>
      )}
    </div>
  );
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function MiniPodcastActivity({ activity, onDiscussWithTutor, onSaveResult }: RendererProps) {
  const [response, setResponse] = useState(activity.lastResponse ?? "");
  const [feedback, setFeedback] = useState<FeedbackState | null>(activity.lastFeedback ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const p = activity.payload ?? {};
  const draftRef = useRef(response);
  draftRef.current = response;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  useEffect(() => () => { if (draftRef.current.trim() && !feedbackRef.current) onSaveResult?.({ lastResponse: draftRef.current }); }, [onSaveResult]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, []);

  const initAudio = () => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio(p.audio_url);
    audio.onended = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.onerror = () => { setIsPlaying(false); };
    audio.onloadedmetadata = () => { setDuration(audio.duration); };
    audio.ontimeupdate = () => { setCurrentTime(audio.currentTime); };
    audioRef.current = audio;
    return audio;
  };

  const handleListen = () => {
    if (p.audio_url) {
      const audio = initAudio();
      audio.playbackRate = playbackRate;
      audio.play();
      setIsPlaying(true);
    } else if ("speechSynthesis" in window && p.summary) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(p.summary);
        utter.rate = playbackRate;
        utter.onend = () => setIsPlaying(false);
        window.speechSynthesis.speak(utter);
      }
      setIsPlaying(true);
    }
  };

  const handlePause = () => {
    if (audioRef.current) { audioRef.current.pause(); }
    if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); }
    setIsPlaying(false);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const bar = progressBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
    setCurrentTime(audioRef.current.currentTime);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const result = await callEvaluate(activity.id, response);
      if (result) {
        setFeedback(result);
        onSaveResult?.({ lastResponse: response, lastFeedback: result });
      } else {
        await new Promise((r) => setTimeout(r, 1000));
        const fb = {
          is_correct: response.trim().length > 20,
          feedback:
            response.trim().length > 20
              ? "Good listening comprehension! You captured the key takeaways."
              : "Try to provide more detail from the overview.",
        };
        setFeedback(fb);
        onSaveResult?.({ lastResponse: response, lastFeedback: fb });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-secondary/20 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Mini Podcast
        </p>
        <p className="mt-1 text-sm font-medium">{activity.topic}</p>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={isPlaying ? handlePause : handleListen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition-colors hover:bg-teal-700"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>

          <div className="min-w-0 flex-1 space-y-1">
            <div
              ref={progressBarRef}
              onClick={handleSeek}
              className="group relative h-1.5 cursor-pointer rounded-full bg-muted"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-teal-500 transition-[width] duration-150"
                style={{ width: `${progressPercent}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-teal-500 bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                style={{ left: `calc(${progressPercent}% - 6px)` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{formatTime(currentTime)}</span>
              <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
            </div>
          </div>

          <div className="flex shrink-0 gap-0.5">
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                onClick={() => setPlaybackRate(speed)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  playbackRate === speed
                    ? "bg-teal-100 text-teal-700"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      </div>
      <details className="group rounded-lg border">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          <EyeOff className="h-3.5 w-3.5 group-open:hidden" />
          <Eye className="hidden h-3.5 w-3.5 group-open:block" />
          <span className="group-open:hidden">Show transcript</span>
          <span className="hidden group-open:inline">Hide transcript</span>
        </summary>
        <div className="border-t px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground/80">{p.summary}</p>
        </div>
      </details>
      {p.question && (
        <>
          <p className="text-sm font-medium">{p.question}</p>
          {!feedback ? (
            <SubmitRow
              value={response}
              onChange={setResponse}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              placeholder="Your answer after listening..."
              multiline
            />
          ) : (
            <>
              {response && (
                <div className="rounded-lg border bg-secondary/20 px-4 py-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your Answer</p>
                  <p className="text-sm leading-relaxed text-foreground/80">{response}</p>
                </div>
              )}
              <FeedbackBanner feedback={feedback} activityTitle={activity.title} onDiscussWithTutor={onDiscussWithTutor} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Card renderer map ────────────────────────────────────────────────────────

function FallbackActivity({ activity }: RendererProps) {
  return (
    <div className="rounded-lg border bg-card px-5 py-8 text-center">
      <p className="text-sm text-muted-foreground">
        No renderer available for activity type &ldquo;{activity.type}&rdquo;.
      </p>
    </div>
  );
}

const ACTIVITY_RENDERERS: Partial<Record<
  ActivityType,
  (props: RendererProps) => React.JSX.Element
>> = {
  flashcard: FlashcardDeckActivity,
  quiz: QuizActivity,
  wrong_on_purpose: WrongOnPurposeActivity,
  scenario: ScenarioActivity,
  feynman: FeynmanActivity,
  mini_podcast: MiniPodcastActivity,
};

// ── Fullscreen overlay ───────────────────────────────────────────────────────

interface ActivityOverlayProps {
  activityId: string;
  activities: Activity[];
  onClose: () => void;
  onDiscussWithTutor?: (context: string) => void;
  onActivitiesChange?: (activities: Activity[]) => void;
}

export function ActivityOverlay({
  activityId,
  activities,
  onClose,
  onDiscussWithTutor,
  onActivitiesChange,
}: ActivityOverlayProps) {
  const activity = activities.find((a) => a.id === activityId);
  if (!activity) return null;
  const config = getTypeConfig(activity.type);
  const Renderer = ACTIVITY_RENDERERS[activity.type] ?? FallbackActivity;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2">
              <config.icon className={`h-4 w-4 ${config.color}`} />
              <span
                className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${config.bg} ${config.color}`}
              >
                {config.label}
              </span>
            </div>
            <span className="font-mono text-xs font-semibold text-xp">
              +{activity.xp} XP
            </span>
          </div>
          <div className="space-y-4 px-5 py-5">
            <div>
              <h3 className="text-lg font-semibold">{activity.title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {activity.topic}
              </p>
            </div>
            <Renderer
              activity={activity}
              onDiscussWithTutor={onDiscussWithTutor}
              onSaveResult={(result) => {
                onActivitiesChange?.(
                  activities.map((a) =>
                    a.id === activity.id
                      ? { ...a, lastResponse: result.lastResponse, ...(result.lastFeedback ? { lastFeedback: result.lastFeedback } : {}) }
                      : a
                  )
                );
              }}
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-card">
          <div className="border-b px-5 py-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Activity History
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">Created</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">Sep 14, 2:30 PM</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">First attempt</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">Sep 15, 10:15 AM</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Completed &mdash; +{activity.xp} XP earned</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">Sep 16, 9:45 AM</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
