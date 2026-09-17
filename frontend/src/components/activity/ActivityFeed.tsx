"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Users,
  ChevronRight,
  X,
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
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivityType =
  | "flashcard"
  | "multi_choice"
  | "true_false"
  | "short_answer"
  | "wrong_on_purpose"
  | "scenario"
  | "feynman"
  | "audio_overview";

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  topic: string;
  xp: number;
  payload?: Record<string, any>;
}

let _activityCounter = 100;

// ── Demo data ────────────────────────────────────────────────────────────────

export const INITIAL_ACTIVITIES: Activity[] = [
  {
    id: "act_fc_1",
    type: "flashcard",
    title: "Gaussian Elimination Definition",
    topic: "Row Reduction & Echelon Forms",
    xp: 25,
    payload: {
      front:
        "What is the goal of Gaussian Elimination?",
      back: "To transform a system of linear equations into row echelon form using elementary row operations, making it easy to solve via back substitution.",
    },
  },
  {
    id: "act_mc_1",
    type: "multi_choice",
    title: "Identifying Pivot Positions",
    topic: "Row Reduction & Echelon Forms",
    xp: 50,
    payload: {
      question:
        "Which of the following is NOT an elementary row operation?",
      options: [
        "Swap two rows",
        "Multiply a row by a nonzero scalar",
        "Multiply two rows together",
        "Add a scalar multiple of one row to another",
      ],
      correct_index: 2,
    },
  },
  {
    id: "act_tf_1",
    type: "true_false",
    title: "Echelon Form Uniqueness",
    topic: "Row Reduction & Echelon Forms",
    xp: 30,
    payload: {
      statement:
        "Every matrix has a unique row echelon form.",
      correct_answer: false,
      explanation:
        "Row echelon form is NOT unique — a matrix can have many row echelon forms. However, the reduced row echelon form (RREF) IS unique.",
    },
  },
  {
    id: "act_sa_1",
    type: "short_answer",
    title: "Explain Back Substitution",
    topic: "Gaussian Elimination & Row Operations",
    xp: 75,
    payload: {
      prompt:
        "Describe in 2–3 sentences how back substitution works once a system is in row echelon form.",
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
    type: "audio_overview",
    title: "Audio Summary: Determinants",
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

export const TYPE_CONFIG: Record<
  ActivityType,
  { label: string; icon: any; color: string; bg: string }
> = {
  flashcard: {
    label: "Flashcard",
    icon: Layers,
    color: "text-sky-500",
    bg: "bg-sky-50",
  },
  multi_choice: {
    label: "Multiple Choice",
    icon: CheckCircle2,
    color: "text-green-500",
    bg: "bg-green-50",
  },
  true_false: {
    label: "True / False",
    icon: ToggleLeft,
    color: "text-indigo-500",
    bg: "bg-indigo-50",
  },
  short_answer: {
    label: "Short Answer",
    icon: PenLine,
    color: "text-orange-500",
    bg: "bg-orange-50",
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
  audio_overview: {
    label: "Audio Overview",
    icon: Headphones,
    color: "text-teal-500",
    bg: "bg-teal-50",
  },
};

const XP_BY_TYPE: Record<ActivityType, number> = {
  flashcard: 25,
  multi_choice: 50,
  true_false: 30,
  short_answer: 75,
  wrong_on_purpose: 75,
  scenario: 100,
  feynman: 50,
  audio_overview: 40,
};

// ── Collapsed list view ──────────────────────────────────────────────────────

interface ActivityFeedProps {
  activities: Activity[];
  onActivitiesChange: (activities: Activity[]) => void;
  onExpandActivity: (id: string) => void;
}

export function ActivityFeed({
  activities,
  onActivitiesChange,
  onExpandActivity,
}: ActivityFeedProps) {
  const [showForm, setShowForm] = useState(false);
  const [fTitle, setFTitle] = useState("");
  const [fTopic, setFTopic] = useState("");
  const [fType, setFType] = useState<ActivityType>("flashcard");

  const inputCls =
    "w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  const handleCreate = () => {
    if (!fTitle.trim() || !fTopic.trim()) return;
    const newActivity: Activity = {
      id: `activity_${++_activityCounter}`,
      type: fType,
      title: fTitle.trim(),
      topic: fTopic.trim(),
      xp: XP_BY_TYPE[fType],
    };
    onActivitiesChange([newActivity, ...activities]);
    setFTitle("");
    setFTopic("");
    setFType("flashcard");
    setShowForm(false);
  };

  const ALL_TYPES: ActivityType[] = [
    "flashcard",
    "multi_choice",
    "true_false",
    "short_answer",
    "wrong_on_purpose",
    "scenario",
    "feynman",
    "audio_overview",
  ];

  return (
    <div className="space-y-2 px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Activity Feed</h2>
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
        <div className="rounded-lg border bg-card px-5 py-4">
          <p className="mb-3 text-sm font-semibold">Create Activity</p>
          <div className="space-y-3">
            <input
              className={inputCls}
              placeholder="Activity title"
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              autoFocus
            />
            <input
              className={inputCls}
              placeholder="Topic (e.g. Row Reduction & Echelon Forms)"
              value={fTopic}
              onChange={(e) => setFTopic(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {ALL_TYPES.map((t) => {
                const c = TYPE_CONFIG[t];
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
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!fTitle.trim() || !fTopic.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {activities.map((activity) => {
        const config = TYPE_CONFIG[activity.type];
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

function FeedbackBanner({ feedback }: { feedback: FeedbackState }) {
  return (
    <div
      className={`rounded-md border p-4 ${
        feedback.is_correct
          ? "border-emerald-200 bg-emerald-50"
          : "border-red-200 bg-red-50"
      }`}
    >
      <p className="text-sm font-semibold">
        {feedback.is_correct ? "Correct!" : "Not quite."}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-foreground/80">
        {feedback.feedback}
      </p>
    </div>
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
        <div className="flex justify-end">
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

function FlashcardActivity({ activity }: { activity: Activity }) {
  const [revealed, setRevealed] = useState(false);
  const p = activity.payload ?? {};
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-secondary/20 p-5">
        <p className="text-center text-sm font-medium leading-relaxed">
          {p.front ?? activity.title}
        </p>
      </div>
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="mx-auto flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Eye className="h-4 w-4" />
          Reveal Answer
        </button>
      ) : (
        <>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-center text-sm leading-relaxed text-foreground/80">
              {p.back ?? "No answer provided."}
            </p>
          </div>
          <button
            onClick={() => setRevealed(false)}
            className="mx-auto flex items-center gap-2 rounded-md border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Flip back
          </button>
        </>
      )}
    </div>
  );
}

function MultiChoiceActivity({ activity }: { activity: Activity }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const p = activity.payload ?? {};
  const options: string[] = p.options ?? [];
  const correct: number = p.correct_index ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium leading-relaxed">
        {p.question ?? activity.title}
      </p>
      <div className="space-y-2">
        {options.map((opt, i) => {
          let cls =
            "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors";
          if (submitted) {
            if (i === correct) cls += " border-emerald-300 bg-emerald-50";
            else if (i === selected) cls += " border-red-300 bg-red-50";
            else cls += " opacity-50";
          } else {
            cls +=
              i === selected
                ? " border-primary bg-primary/5"
                : " hover:bg-accent/30";
          }
          return (
            <button
              key={i}
              onClick={() => !submitted && setSelected(i)}
              className={cls}
              disabled={submitted}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  i === selected && !submitted
                    ? "border-primary bg-primary text-primary-foreground"
                    : ""
                }`}
              >
                {String.fromCharCode(65 + i)}
              </span>
              {opt}
            </button>
          );
        })}
      </div>
      {!submitted ? (
        <div className="flex justify-end">
          <button
            onClick={() => setSubmitted(true)}
            disabled={selected === null}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
          >
            Check Answer
          </button>
        </div>
      ) : (
        <FeedbackBanner
          feedback={{
            is_correct: selected === correct,
            feedback:
              selected === correct
                ? "That's right!"
                : `The correct answer is ${String.fromCharCode(65 + correct)}: ${options[correct]}.`,
          }}
        />
      )}
    </div>
  );
}

function TrueFalseActivity({ activity }: { activity: Activity }) {
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const p = activity.payload ?? {};
  const correct: boolean = p.correct_answer ?? true;

  const handlePick = (val: boolean) => {
    if (submitted) return;
    setAnswer(val);
    setSubmitted(true);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-secondary/20 p-5">
        <p className="text-center text-sm font-medium leading-relaxed">
          {p.statement ?? activity.title}
        </p>
      </div>
      <div className="flex justify-center gap-4">
        {[true, false].map((val) => {
          let cls =
            "rounded-lg border px-8 py-3 text-sm font-semibold transition-colors";
          if (submitted) {
            if (val === correct) cls += " border-emerald-300 bg-emerald-50 text-emerald-700";
            else if (val === answer) cls += " border-red-300 bg-red-50 text-red-700";
            else cls += " opacity-40";
          } else {
            cls += " hover:bg-accent/30";
          }
          return (
            <button key={String(val)} onClick={() => handlePick(val)} className={cls} disabled={submitted}>
              {val ? "True" : "False"}
            </button>
          );
        })}
      </div>
      {submitted && (
        <FeedbackBanner
          feedback={{
            is_correct: answer === correct,
            feedback:
              answer === correct
                ? "Correct!"
                : p.explanation ?? `The answer is ${correct ? "True" : "False"}.`,
          }}
        />
      )}
    </div>
  );
}

function ShortAnswerActivity({ activity }: { activity: Activity }) {
  const [response, setResponse] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/activities/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-User": "usr_student_demo" },
        body: JSON.stringify({ claim_id: activity.id, student_response: response }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setFeedback({ is_correct: data.is_correct, feedback: data.feedback });
      } else {
        await new Promise((r) => setTimeout(r, 1000));
        setFeedback({
          is_correct: response.trim().length > 20,
          feedback:
            response.trim().length > 20
              ? "Good response! Your explanation demonstrates understanding of the core concept."
              : "Try to provide a more detailed explanation. Think about the key steps involved.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium leading-relaxed">{p.prompt ?? activity.title}</p>
      {!feedback ? (
        <SubmitRow
          value={response}
          onChange={setResponse}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder="Type your answer..."
          multiline
        />
      ) : (
        <FeedbackBanner feedback={feedback} />
      )}
    </div>
  );
}

function WrongOnPurposeActivity({ activity }: { activity: Activity }) {
  const [response, setResponse] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/activities/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-User": "usr_student_demo" },
        body: JSON.stringify({ claim_id: activity.id, student_response: response }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setFeedback({ is_correct: data.is_correct, feedback: data.feedback });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        const isCorrect = response.trim().length > 30;
        setFeedback({
          is_correct: isCorrect,
          feedback: isCorrect
            ? "Good catch! You correctly identified the flaw in the reasoning."
            : "Not quite. Look more carefully at the assumptions being made.",
        });
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
        <FeedbackBanner feedback={feedback} />
      )}
    </div>
  );
}

function ScenarioActivity({ activity }: { activity: Activity }) {
  const [response, setResponse] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/activities/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-User": "usr_student_demo" },
        body: JSON.stringify({ claim_id: activity.id, student_response: response }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setFeedback({ is_correct: data.is_correct, feedback: data.feedback });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        setFeedback({
          is_correct: response.trim().length > 40,
          feedback:
            response.trim().length > 40
              ? "Strong analysis! You've correctly applied the relevant concepts to this scenario."
              : "Try to be more thorough. Consider the constraints and how linear algebra applies here.",
        });
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
        <FeedbackBanner feedback={feedback} />
      )}
    </div>
  );
}

function FeynmanActivity({ activity }: { activity: Activity }) {
  const [response, setResponse] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const p = activity.payload ?? {};

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/activities/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-User": "usr_student_demo" },
        body: JSON.stringify({ claim_id: activity.id, student_response: response }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setFeedback({ is_correct: data.is_correct, feedback: data.feedback });
      } else {
        await new Promise((r) => setTimeout(r, 1200));
        setFeedback({
          is_correct: response.trim().length > 30,
          feedback:
            response.trim().length > 30
              ? "Great explanation! You demonstrate a solid grasp of the concept."
              : "Your explanation is a bit brief. Try to explain it as if teaching someone who has never seen this before.",
        });
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
        <FeedbackBanner feedback={feedback} />
      )}
    </div>
  );
}

function AudioOverviewActivity({ activity }: { activity: Activity }) {
  const [response, setResponse] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const p = activity.payload ?? {};

  const handleListen = () => {
    if ("speechSynthesis" in window && p.summary) {
      const utter = new SpeechSynthesisUtterance(p.summary);
      utter.rate = 0.95;
      utter.onend = () => setIsPlaying(false);
      setIsPlaying(true);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  const handleSubmit = async () => {
    if (!response.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/activities/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Demo-User": "usr_student_demo" },
        body: JSON.stringify({ claim_id: activity.id, student_response: response }),
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setFeedback({ is_correct: data.is_correct, feedback: data.feedback });
      } else {
        await new Promise((r) => setTimeout(r, 1000));
        setFeedback({
          is_correct: response.trim().length > 20,
          feedback:
            response.trim().length > 20
              ? "Good listening comprehension! You captured the key takeaways."
              : "Try to provide more detail from the overview.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-secondary/20 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Audio Summary
          </p>
          <p className="mt-1 text-sm font-medium">{activity.topic}</p>
        </div>
        <button
          onClick={isPlaying ? handleStop : handleListen}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            isPlaying
              ? "bg-red-100 text-red-700 hover:bg-red-200"
              : "bg-teal-100 text-teal-700 hover:bg-teal-200"
          }`}
        >
          <Headphones className="h-4 w-4" />
          {isPlaying ? "Stop" : "Listen"}
        </button>
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
            <FeedbackBanner feedback={feedback} />
          )}
        </>
      )}
    </div>
  );
}

// ── Card renderer map ────────────────────────────────────────────────────────

const ACTIVITY_RENDERERS: Record<
  ActivityType,
  (props: { activity: Activity }) => React.JSX.Element
> = {
  flashcard: FlashcardActivity,
  multi_choice: MultiChoiceActivity,
  true_false: TrueFalseActivity,
  short_answer: ShortAnswerActivity,
  wrong_on_purpose: WrongOnPurposeActivity,
  scenario: ScenarioActivity,
  feynman: FeynmanActivity,
  audio_overview: AudioOverviewActivity,
};

// ── Fullscreen overlay ───────────────────────────────────────────────────────

interface ActivityOverlayProps {
  activityId: string;
  activities: Activity[];
  onClose: () => void;
}

export function ActivityOverlay({
  activityId,
  activities,
  onClose,
}: ActivityOverlayProps) {
  const activity = activities.find((a) => a.id === activityId);
  if (!activity) return null;
  const config = TYPE_CONFIG[activity.type];
  const Renderer = ACTIVITY_RENDERERS[activity.type];

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
            <Renderer activity={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}
