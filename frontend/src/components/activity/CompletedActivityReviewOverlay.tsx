"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, MessageSquare, Bot, Clock, User, CheckCircle2, XCircle, AlertCircle, Play, Pause, Eye, EyeOff } from "lucide-react";
import { getTypeConfig } from "@/components/activity/ActivityFeed";
import type { ActivityType } from "@/components/activity/ActivityFeed";

export interface CompletedActivityReview {
  id: string;
  activityType: string;
  activityTitle: string;
  claimTitle: string | null;
  topic: string | null;
  studentName: string | null;
  studentResponse: string | null;
  feedback: string | null;
  outcome: string;
  xpAwarded: number;
  attemptedAt: string | null;
  payload?: Record<string, any> | null;
}

interface CompletedActivityReviewOverlayProps {
  review: CompletedActivityReview;
  onClose: () => void;
  onDiscussWithTutor?: (context: string) => void;
}

// ── Quiz helpers (mirrors ActivityFeed.tsx types) ────────────────────────────

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

function isCorrectAnswer(q: QuizQuestionDef, answer: any): { correct: boolean; needsReview: boolean } {
  if (answer === undefined || answer === null) return { correct: false, needsReview: false };
  switch (q.type) {
    case "multi_choice": return { correct: answer === q.correct_index, needsReview: false };
    case "true_false": return { correct: answer === q.correct_answer, needsReview: false };
    case "short_answer": return { correct: false, needsReview: true };
    case "fill_blank": {
      if (!Array.isArray(answer)) return { correct: false, needsReview: false };
      const correct = q.blanks.every((b, i) =>
        (answer[i] ?? "").toString().toLowerCase().trim() === b.toLowerCase().trim()
      );
      return { correct, needsReview: false };
    }
  }
}

function formatStudentAnswer(q: QuizQuestionDef, answer: any): string {
  if (answer === undefined || answer === null) return "No answer";
  switch (q.type) {
    case "multi_choice": {
      const idx = Number(answer);
      const letter = String.fromCharCode(65 + idx);
      return `${letter}) ${q.options[idx] ?? "Unknown"}`;
    }
    case "true_false": return answer ? "True" : "False";
    case "short_answer": return String(answer);
    case "fill_blank": return Array.isArray(answer) ? answer.join(", ") : String(answer);
  }
}

function formatCorrectAnswer(q: QuizQuestionDef): string | null {
  switch (q.type) {
    case "multi_choice": {
      const letter = String.fromCharCode(65 + q.correct_index);
      return `${letter}) ${q.options[q.correct_index]}`;
    }
    case "true_false": return q.correct_answer ? "True" : "False";
    case "short_answer": return null;
    case "fill_blank": return q.blanks.join(", ");
  }
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  multi_choice: "Multiple Choice",
  true_false: "True / False",
  short_answer: "Short Answer",
  fill_blank: "Fill in the Blank",
};

// ── Quiz Breakdown Section ──────────────────────────────────────────────────

function QuizBreakdownSection({
  questions,
  answers,
}: {
  questions: QuizQuestionDef[];
  answers: Record<number, any>;
}) {
  let correctCount = 0;
  let needsReviewCount = 0;

  const graded = questions.map((q, i) => {
    const answer = answers[i];
    const result = isCorrectAnswer(q, answer);
    if (result.correct) correctCount++;
    if (result.needsReview) needsReviewCount++;
    return { question: q, answer, index: i, ...result };
  });

  const total = questions.length;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const passed = correctCount > total / 2;

  return (
    <div className="space-y-4">
      {/* Score header */}
      <div className="flex items-center justify-between rounded-lg border bg-secondary/20 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">
            {correctCount}/{total}
          </span>
          <span className="text-sm text-muted-foreground">{pct}% correct</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            passed
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {passed ? "Passed" : "Needs improvement"}
        </span>
      </div>

      {/* Per-question breakdown */}
      <div>
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Question Breakdown
        </p>
        <div className="divide-y rounded-lg border">
          {graded.map((g) => (
            <div key={g.index} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {g.needsReview ? (
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  ) : g.correct ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      Q{g.index + 1}.{" "}
                      {getQuestionText(g.question).length > 80
                        ? getQuestionText(g.question).slice(0, 80) + "..."
                        : getQuestionText(g.question)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {QUESTION_TYPE_LABELS[g.question.type] ?? g.question.type}
                    </span>
                    <span className="text-muted-foreground">&middot;</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        g.needsReview
                          ? "bg-amber-50 text-amber-700"
                          : g.correct
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                      }`}
                    >
                      {g.needsReview ? "Needs review" : g.correct ? "Correct" : "Incorrect"}
                    </span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Answered: </span>
                    <span className="text-foreground/80">
                      {formatStudentAnswer(g.question, g.answer)}
                    </span>
                  </div>
                  {!g.correct && !g.needsReview && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Correct: </span>
                      <span className="font-medium text-emerald-700">
                        {formatCorrectAnswer(g.question)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

// ── Mini-Podcast Player ─────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function PodcastPlayer({ payload }: { payload: Record<string, any> }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  const initAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio(payload.audio_url);
    audio.onended = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.onerror = () => { setIsPlaying(false); };
    audio.onloadedmetadata = () => { setDuration(audio.duration); };
    audio.ontimeupdate = () => { setCurrentTime(audio.currentTime); };
    audioRef.current = audio;
    return audio;
  }, [payload.audio_url]);

  const handlePlay = () => {
    if (payload.audio_url) {
      const audio = initAudio();
      audio.playbackRate = playbackRate;
      audio.play();
      setIsPlaying(true);
    } else if ("speechSynthesis" in window && payload.summary) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(payload.summary);
        utter.rate = playbackRate;
        utter.onend = () => setIsPlaying(false);
        window.speechSynthesis.speak(utter);
      }
      setIsPlaying(true);
    }
  };

  const handlePause = () => {
    if (audioRef.current) audioRef.current.pause();
    if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
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

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-secondary/20 p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={isPlaying ? handlePause : handlePlay}
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
              <span>{fmtTime(currentTime)}</span>
              <span>{duration > 0 ? fmtTime(duration) : "--:--"}</span>
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

      {payload.summary && (
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showTranscript ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showTranscript ? "Hide transcript" : "Show transcript"}
        </button>
      )}
      {showTranscript && payload.summary && (
        <div className="rounded-lg border px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground/80">{payload.summary}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Overlay ────────────────────────────────────────────────────────────

export function CompletedActivityReviewOverlay({
  review,
  onClose,
  onDiscussWithTutor,
}: CompletedActivityReviewOverlayProps) {
  const config = getTypeConfig(review.activityType as ActivityType);
  const Icon = config.icon;
  const isCorrect = review.outcome === "understood";

  const isQuiz = review.activityType === "quiz";
  const quizQuestions: QuizQuestionDef[] | null =
    isQuiz && review.payload?.questions && Array.isArray(review.payload.questions)
      ? review.payload.questions
      : null;
  const quizAnswers: Record<number, any> = (() => {
    if (!quizQuestions || !review.studentResponse) return {};
    try { return JSON.parse(review.studentResponse); } catch (err) { console.warn("CompletedActivityReviewOverlay: failed to parse student response:", err); return {}; }
  })();

  const handleDiscuss = () => {
    if (!onDiscussWithTutor) return;
    const who = review.studentName
      ? `${review.studentName}'s attempt on`
      : "";
    const context = isCorrect
      ? `I'm reviewing ${who} the activity "${review.activityTitle}"${review.claimTitle ? ` (${review.claimTitle})` : ""}. The student answered correctly. Here's the feedback:\n\n"${review.feedback ?? ""}"\n\nCan you help me explore this topic further?`
      : `I'm reviewing ${who} the activity "${review.activityTitle}"${review.claimTitle ? ` (${review.claimTitle})` : ""}. The student's response was:\n\n"${review.studentResponse ?? ""}"\n\nThe feedback was:\n\n"${review.feedback ?? ""}"\n\nCan you help me understand what went wrong and how to improve?`;
    onDiscussWithTutor(context);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="rounded-lg border bg-card">
          {/* Header bar */}
          <div className="flex items-center gap-3 border-b px-5 py-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${config.color}20` }}
            >
              <Icon className="h-4 w-4" style={{ color: config.color }} />
            </div>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: `${config.color}15`,
                color: config.color,
              }}
            >
              {config.label}
            </span>
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isCorrect
                  ? "bg-emerald-50 text-emerald-700"
                  : review.outcome === "did_not_understand"
                    ? "bg-red-50 text-red-700"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              {isCorrect
                ? "Understood"
                : review.outcome === "did_not_understand"
                  ? "Needs Review"
                  : "Partial"}
            </span>
            <span className="ml-auto font-mono text-sm font-bold text-xp">
              +{review.xpAwarded} XP
            </span>
          </div>

          {/* Content body */}
          <div className="space-y-5 px-5 py-5">
            {/* Title + metadata */}
            <div>
              <h2 className="text-lg font-bold">{review.activityTitle}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {review.claimTitle && (
                  <span>Claim: {review.claimTitle}</span>
                )}
                {review.topic && <span>Topic: {review.topic}</span>}
                {review.studentName && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {review.studentName}
                  </span>
                )}
                {review.attemptedAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {relativeTime(review.attemptedAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Mini-podcast audio player */}
            {review.activityType === "mini_podcast" && review.payload && (
              <PodcastPlayer payload={review.payload} />
            )}

            {/* Quiz breakdown OR flat student response */}
            {quizQuestions && quizQuestions.length > 0 ? (
              <QuizBreakdownSection
                questions={quizQuestions}
                answers={quizAnswers}
              />
            ) : (
              <div className="rounded-lg border bg-secondary/20 px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest">
                    Student Response
                  </span>
                </div>
                {review.studentResponse ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                    {review.studentResponse}
                  </p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    No response recorded
                  </p>
                )}
              </div>
            )}

            {/* AI Feedback (FeedbackBanner style) */}
            {review.feedback && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1 rounded-lg border bg-card px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-primary">
                      Axiom AI
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isCorrect
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {isCorrect ? "Correct" : "Review needed"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                    {review.feedback}
                  </p>
                  {onDiscussWithTutor && (
                    <button
                      onClick={handleDiscuss}
                      className="mt-3 flex items-center gap-2 rounded-md border border-primary/30 bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Discuss in Chat
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
