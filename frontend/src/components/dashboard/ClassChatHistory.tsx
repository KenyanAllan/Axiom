"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  X,
  Bot,
  User,
  Clock,
  Search,
  Loader2,
} from "lucide-react";
import {
  fetchClassroomChatHistory,
  fetchClassroomChatSession,
} from "@/lib/api";
import type {
  ClassChatSessionItem,
  ClassChatSessionDetail,
  ClassChatMessageItem,
} from "@/lib/api";

// ── Demo data ───────────────────────────────────────────────────────────────

const DEMO_CHAT_SESSIONS: ClassChatSessionItem[] = [
  {
    session_id: 101,
    student_name: "Alice Chen",
    student_id: "student_alice",
    title: "Gaussian Elimination Steps",
    message_count: 6,
    created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
  },
  {
    session_id: 102,
    student_name: "Bob Martinez",
    student_id: "student_bob",
    title: "Matrix Inverse Help",
    message_count: 4,
    created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    session_id: 103,
    student_name: "Carol Davis",
    student_id: "student_carol",
    title: "Eigenvalue Confusion",
    message_count: 8,
    created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
  },
  {
    session_id: 104,
    student_name: "Alice Chen",
    student_id: "student_alice",
    title: "Row Echelon Form vs RREF",
    message_count: 3,
    created_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
  },
  {
    session_id: 105,
    student_name: "David Kim",
    student_id: "student_david",
    title: "Determinant Calculation",
    message_count: 5,
    created_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
  {
    session_id: 106,
    student_name: "Eve Johnson",
    student_id: "student_eve",
    title: "Linear Independence",
    message_count: 7,
    created_at: new Date(Date.now() - 48 * 3600_000).toISOString(),
  },
];

const DEMO_MESSAGES: Record<number, ClassChatMessageItem[]> = {
  101: [
    { role: "user", content: "Can you walk me through how Gaussian elimination works step by step?", created_at: new Date(Date.now() - 30 * 60_000).toISOString() },
    { role: "assistant", content: "Of course! Gaussian elimination has two main phases:\n\n**1. Forward Elimination** — Transform the augmented matrix into row echelon form (REF) by creating zeros below each pivot.\n\n**2. Back Substitution** — Starting from the last row, solve for each variable moving upward.\n\nLet's start with an example. Consider the system:\n```\n2x + y - z = 8\n-3x - y + 2z = -11\n-2x + y + 2z = -3\n```\n\nThe augmented matrix is:\n```\n[ 2   1  -1 |  8 ]\n[-3  -1   2 | -11]\n[-2   1   2 | -3 ]\n```\n\nWould you like me to continue with the row operations?", created_at: new Date(Date.now() - 29 * 60_000).toISOString() },
    { role: "user", content: "Yes please! Show me the row operations.", created_at: new Date(Date.now() - 28 * 60_000).toISOString() },
    { role: "assistant", content: "**Step 1:** Eliminate the first column below the pivot (2).\n\n• R₂ = R₂ + (3/2)R₁:\n```\n[ 2   1    -1  |  8  ]\n[ 0   1/2  1/2 |  1  ]\n[-2   1    2   | -3  ]\n```\n\n• R₃ = R₃ + R₁:\n```\n[ 2  1    -1  |  8 ]\n[ 0  1/2  1/2 |  1 ]\n[ 0  2    1   |  5 ]\n```\n\n**Step 2:** Eliminate below the second pivot (1/2).\n\n• R₃ = R₃ - 4·R₂:\n```\n[ 2  1    -1  |  8 ]\n[ 0  1/2  1/2 |  1 ]\n[ 0  0    -1  |  1 ]\n```\n\nNow we're in REF! Ready for back substitution?", created_at: new Date(Date.now() - 27 * 60_000).toISOString() },
    { role: "user", content: "Got it! So from the last row, z = -1, then I substitute back?", created_at: new Date(Date.now() - 26 * 60_000).toISOString() },
    { role: "assistant", content: "Exactly! From the last row: **-z = 1**, so **z = -1**.\n\nSubstitute z = -1 into row 2:\n(1/2)y + (1/2)(-1) = 1 → (1/2)y = 3/2 → **y = 3**\n\nSubstitute y = 3 and z = -1 into row 1:\n2x + 3 - (-1) = 8 → 2x + 4 = 8 → **x = 2**\n\nSolution: **(x, y, z) = (2, 3, -1)** ✓\n\nYou've got the hang of it! The key insight is that REF makes back substitution straightforward because each row has one fewer unknown.", created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
  ],
  102: [
    { role: "user", content: "How do I find the inverse of a 3x3 matrix?", created_at: new Date(Date.now() - 2.5 * 3600_000).toISOString() },
    { role: "assistant", content: "The most systematic method is **augmented row reduction**:\n\n1. Write [A | I₃] — your matrix augmented with the 3×3 identity\n2. Row-reduce the left side to I₃\n3. The right side becomes A⁻¹\n\nIf at any point you can't get I₃ on the left (e.g., you get a row of zeros), the matrix is **singular** (not invertible).\n\nWould you like to try one together?", created_at: new Date(Date.now() - 2.4 * 3600_000).toISOString() },
    { role: "user", content: "What if the determinant is zero? Does that mean it has no inverse?", created_at: new Date(Date.now() - 2.3 * 3600_000).toISOString() },
    { role: "assistant", content: "Yes, exactly! A matrix A is invertible **if and only if** det(A) ≠ 0.\n\nThis is part of the **Invertible Matrix Theorem**, which connects many equivalent conditions:\n- det(A) ≠ 0\n- A has n pivot positions\n- The columns of A are linearly independent\n- Ax = 0 has only the trivial solution\n- A is row equivalent to Iₙ\n\nAll of these are saying the same thing in different ways. If any one fails, they all fail, and the matrix has no inverse.", created_at: new Date(Date.now() - 2.2 * 3600_000).toISOString() },
  ],
  103: [
    { role: "user", content: "I'm confused about eigenvalues. What are they actually measuring?", created_at: new Date(Date.now() - 6 * 3600_000).toISOString() },
    { role: "assistant", content: "Great question! An eigenvalue tells you **how much a matrix stretches or compresses vectors in a particular direction**.\n\nWhen you have Ax = λx:\n- **x** is the eigenvector — a special direction that doesn't change when you apply the transformation A\n- **λ** is the eigenvalue — the scaling factor along that direction\n\nFor example:\n- λ = 2 means vectors in that direction get doubled\n- λ = -1 means they flip direction (and keep the same length)\n- λ = 0 means that direction gets collapsed to zero", created_at: new Date(Date.now() - 5.9 * 3600_000).toISOString() },
    { role: "user", content: "How do I actually find them?", created_at: new Date(Date.now() - 5.8 * 3600_000).toISOString() },
    { role: "assistant", content: "You solve the **characteristic equation**: det(A - λI) = 0.\n\nFor a 2×2 matrix [[a, b], [c, d]]:\n\ndet(A - λI) = (a-λ)(d-λ) - bc = 0\n\nThis gives you a polynomial in λ. The roots are your eigenvalues.\n\nFor a 3×3 matrix, you get a cubic polynomial — same idea, just more algebra.\n\nOnce you have each eigenvalue λ, find the eigenvectors by solving (A - λI)x = 0.", created_at: new Date(Date.now() - 5.7 * 3600_000).toISOString() },
    { role: "user", content: "What if I get complex eigenvalues?", created_at: new Date(Date.now() - 5.6 * 3600_000).toISOString() },
    { role: "assistant", content: "Complex eigenvalues come in conjugate pairs (a + bi and a - bi) and indicate **rotation** in the transformation.\n\nThe real part 'a' controls scaling, and the imaginary part 'b' controls the rotation angle: θ = arctan(b/a).\n\nFor example, a rotation matrix:\n```\n[cos θ  -sin θ]\n[sin θ   cos θ]\n```\nhas eigenvalues cos θ ± i·sin θ — pure rotation, no scaling.\n\nIn a real-world context, complex eigenvalues show up in oscillating systems (springs, circuits, etc.).", created_at: new Date(Date.now() - 5.5 * 3600_000).toISOString() },
    { role: "user", content: "Can a matrix have repeated eigenvalues?", created_at: new Date(Date.now() - 5.4 * 3600_000).toISOString() },
    { role: "assistant", content: "Yes! This is called **algebraic multiplicity**. For example, the identity matrix I has eigenvalue λ = 1 with multiplicity n.\n\nThe important thing to check is the **geometric multiplicity** — the dimension of the eigenspace for that eigenvalue. If geometric multiplicity < algebraic multiplicity, the matrix is **not diagonalizable**.\n\nA classic example: [[2, 1], [0, 2]] has eigenvalue λ = 2 with algebraic multiplicity 2, but only one linearly independent eigenvector. So it's not diagonalizable — you'd need a Jordan form instead.", created_at: new Date(Date.now() - 5.3 * 3600_000).toISOString() },
    { role: "user", content: "This is making so much more sense now. Thanks!", created_at: new Date(Date.now() - 5.2 * 3600_000).toISOString() },
    { role: "assistant", content: "You're welcome! You've covered a lot of ground:\n\n✅ Eigenvalues = scaling factors along special directions\n✅ Found via det(A - λI) = 0\n✅ Complex eigenvalues → rotation\n✅ Repeated eigenvalues → check geometric vs algebraic multiplicity\n\nIf you want more practice, try finding the eigenvalues of some 2×2 matrices — it's great for building intuition!", created_at: new Date(Date.now() - 5.1 * 3600_000).toISOString() },
  ],
  104: [
    { role: "user", content: "What's the difference between REF and RREF?", created_at: new Date(Date.now() - 25 * 3600_000).toISOString() },
    { role: "assistant", content: "Both are \"staircase\" forms, but RREF is more reduced:\n\n**REF (Row Echelon Form):**\n- All zero rows at the bottom\n- Each leading entry is to the right of the one above\n- Zeros below each leading entry\n\n**RREF (Reduced Row Echelon Form):**\n- Everything in REF, PLUS:\n- Each leading entry is 1\n- Zeros **above and below** each leading entry\n\nREF example:\n```\n[2  3  1]\n[0  1  4]\n[0  0  5]\n```\n\nRREF:\n```\n[1  0  0]\n[0  1  0]\n[0  0  1]\n```\n\nKey difference: RREF is **unique** for any matrix, while REF is not.", created_at: new Date(Date.now() - 24.9 * 3600_000).toISOString() },
    { role: "user", content: "Why would I use REF instead of always going to RREF?", created_at: new Date(Date.now() - 24.8 * 3600_000).toISOString() },
    { role: "assistant", content: "Great practical question! REF + back substitution is often **faster** than computing full RREF, especially by hand. RREF requires more row operations (eliminating above each pivot too). For computer algorithms, the difference is smaller, but REF is still preferred in many numerical methods because it involves fewer operations and accumulates less rounding error.", created_at: new Date(Date.now() - 24.7 * 3600_000).toISOString() },
  ],
  105: [
    { role: "user", content: "How do I calculate a 3x3 determinant? I keep getting the wrong answer.", created_at: new Date(Date.now() - 27 * 3600_000).toISOString() },
    { role: "assistant", content: "The most common method is **cofactor expansion** along the first row:\n\nFor matrix [[a,b,c],[d,e,f],[g,h,i]]:\n\ndet = a(ei - fh) - b(di - fg) + c(dh - eg)\n\nNotice the alternating signs: +, -, +\n\nA common mistake is forgetting the sign pattern or mixing up which 2×2 submatrix goes with each entry. Each element's minor is the 2×2 matrix you get by crossing out that element's row and column.", created_at: new Date(Date.now() - 26.9 * 3600_000).toISOString() },
    { role: "user", content: "Can I expand along any row or column?", created_at: new Date(Date.now() - 26.8 * 3600_000).toISOString() },
    { role: "assistant", content: "Yes! You can expand along **any** row or column and get the same answer. The sign pattern is a checkerboard:\n```\n[+  -  +]\n[-  +  -]\n[+  -  +]\n```\n\nPro tip: expand along the row or column with the most zeros — each zero means one fewer 2×2 determinant to compute!", created_at: new Date(Date.now() - 26.7 * 3600_000).toISOString() },
    { role: "user", content: "Oh that's clever! What about using row operations first?", created_at: new Date(Date.now() - 26.6 * 3600_000).toISOString() },
    { role: "assistant", content: "Even better for larger matrices! Row operations have specific effects on the determinant:\n\n1. **Row swap** → multiplies det by -1\n2. **Multiply a row by k** → multiplies det by k\n3. **Add a multiple of one row to another** → det unchanged\n\nSo you can row-reduce to an upper triangular matrix (tracking sign changes from swaps), then the determinant is just the product of the diagonal entries. This is much faster for 4×4 and larger!", created_at: new Date(Date.now() - 26.5 * 3600_000).toISOString() },
    { role: "user", content: "That makes way more sense. Thanks for explaining the row operation approach!", created_at: new Date(Date.now() - 26.4 * 3600_000).toISOString() },
  ],
  106: [
    { role: "user", content: "I don't understand what linear independence means. Can you explain?", created_at: new Date(Date.now() - 49 * 3600_000).toISOString() },
    { role: "assistant", content: "A set of vectors {v₁, v₂, ..., vₖ} is **linearly independent** if no vector in the set can be written as a combination of the others.\n\nFormally: the only solution to c₁v₁ + c₂v₂ + ... + cₖvₖ = 0 is c₁ = c₂ = ... = cₖ = 0.\n\nIntuitively: each vector adds a genuinely new \"direction\" to the set. If one vector is redundant (expressible from the others), the set is linearly **dependent**.", created_at: new Date(Date.now() - 48.9 * 3600_000).toISOString() },
    { role: "user", content: "How can I test if vectors are independent?", created_at: new Date(Date.now() - 48.8 * 3600_000).toISOString() },
    { role: "assistant", content: "Put them as columns in a matrix and row-reduce!\n\nIf every column has a pivot → **linearly independent**\nIf any column lacks a pivot → **linearly dependent** (that column's vector is a combo of the others)\n\nEquivalently, for square matrices: the vectors are independent iff det ≠ 0.\n\nQuick shortcut: in Rⁿ, any set of more than n vectors must be linearly dependent (pigeonhole principle).", created_at: new Date(Date.now() - 48.7 * 3600_000).toISOString() },
    { role: "user", content: "What about in R3, can 2 vectors be independent?", created_at: new Date(Date.now() - 48.6 * 3600_000).toISOString() },
    { role: "assistant", content: "Yes! In R³, two vectors are linearly independent as long as one isn't a scalar multiple of the other (i.e., they don't point in the same or opposite direction).\n\nFor example:\n- v₁ = [1, 0, 0] and v₂ = [0, 1, 0] → independent (different directions)\n- v₁ = [1, 2, 3] and v₂ = [2, 4, 6] → dependent (v₂ = 2·v₁)\n\nTwo independent vectors in R³ span a plane through the origin. You'd need a third independent vector to span all of R³.", created_at: new Date(Date.now() - 48.5 * 3600_000).toISOString() },
    { role: "user", content: "Why does this matter for solving systems of equations?", created_at: new Date(Date.now() - 48.4 * 3600_000).toISOString() },
    { role: "assistant", content: "It's directly connected! For the system Ax = b:\n\n- If columns of A are **independent** → at most one solution (either unique or none)\n- If columns are **dependent** → either no solution or infinitely many\n\nAnd from the Invertible Matrix Theorem: a square matrix A is invertible (unique solution for every b) **if and only if** its columns are linearly independent.\n\nSo linear independence is really the key property that determines whether systems have unique solutions!", created_at: new Date(Date.now() - 48.3 * 3600_000).toISOString() },
    { role: "user", content: "This all connects together nicely. Thanks!", created_at: new Date(Date.now() - 48.2 * 3600_000).toISOString() },
    { role: "assistant", content: "Exactly — that's the beautiful thing about linear algebra! Independence, rank, determinants, invertibility, and unique solutions are all different facets of the same underlying concept. Once you see the connections, the whole subject clicks into place. Keep up the great work!", created_at: new Date(Date.now() - 48.1 * 3600_000).toISOString() },
  ],
};

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

// ── Chat Conversation Overlay ───────────────────────────────────────────────

function ChatConversationOverlay({
  detail,
  onClose,
}: {
  detail: ClassChatSessionDetail;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-bold">{detail.title ?? "Untitled Chat"}</h2>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {detail.student_name}
              </span>
              <span>{detail.messages.length} messages</span>
              {detail.created_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {relativeTime(detail.created_at)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {detail.messages.map((msg, i) => (
              <div key={i} className="flex gap-3">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    msg.role === "user"
                      ? "bg-secondary text-muted-foreground"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">
                      {msg.role === "user" ? detail.student_name : "Axiom AI"}
                    </span>
                    {msg.created_at && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

interface ClassChatHistoryProps {
  userId: string;
}

export function ClassChatHistory({ userId }: ClassChatHistoryProps) {
  const [sessions, setSessions] = useState<ClassChatSessionItem[]>(DEMO_CHAT_SESSIONS);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingDetail, setViewingDetail] = useState<ClassChatSessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState<number | null>(null);
  const [classroomId, setClassroomId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/classrooms`,
          { headers: { "X-Demo-User": userId } }
        );
        if (!res.ok) return;
        const classrooms = await res.json();
        if (classrooms.length > 0) {
          const id = classrooms[0].id;
          setClassroomId(id);
          const history = await fetchClassroomChatHistory(userId, id);
          if (history.items.length > 0) {
            setSessions(history.items);
          }
        }
      } catch {
        // keep demo data
      }
    })();
  }, [userId]);

  const handleViewSession = useCallback(
    async (session: ClassChatSessionItem) => {
      setLoadingSession(session.session_id);

      // Try demo data first
      const demoMessages = DEMO_MESSAGES[session.session_id];
      if (demoMessages) {
        setViewingDetail({
          session_id: session.session_id,
          student_name: session.student_name,
          student_id: session.student_id,
          title: session.title,
          created_at: session.created_at,
          messages: demoMessages,
        });
        setLoadingSession(null);
        return;
      }

      // Try API
      if (classroomId) {
        try {
          const detail = await fetchClassroomChatSession(userId, classroomId, session.session_id);
          setViewingDetail(detail);
          setLoadingSession(null);
          return;
        } catch {
          // fall through
        }
      }

      setViewingDetail({
        session_id: session.session_id,
        student_name: session.student_name,
        student_id: session.student_id,
        title: session.title,
        created_at: session.created_at,
        messages: [
          { role: "user", content: "Hello, I have a question.", created_at: session.created_at },
          { role: "assistant", content: "Of course! How can I help?", created_at: session.created_at },
        ],
      });
      setLoadingSession(null);
    },
    [classroomId, userId]
  );

  const filtered = searchQuery
    ? sessions.filter(
        (s) =>
          s.student_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.title ?? "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  return (
    <div className="px-6 py-5">
      <div className="mb-6">
        <h2 className="text-xl font-bold">Class Chat History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          View all student conversations with Axiom AI.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by student or topic..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
        />
      </div>

      {/* Session list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? "No matching conversations found." : "No student conversations yet."}
          </p>
        ) : (
          filtered.map((session) => (
            <button
              key={session.session_id}
              onClick={() => handleViewSession(session)}
              className="flex w-full items-center gap-4 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {session.title ?? "Untitled Chat"}
                  </span>
                  {loadingSession === session.session_id && (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {session.student_name}
                  </span>
                  <span>&middot;</span>
                  <span>{session.message_count} messages</span>
                  {session.created_at && (
                    <>
                      <span>&middot;</span>
                      <span>{relativeTime(session.created_at)}</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Conversation overlay */}
      {viewingDetail && (
        <ChatConversationOverlay
          detail={viewingDetail}
          onClose={() => setViewingDetail(null)}
        />
      )}
    </div>
  );
}
