"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  LayoutList,
  MessageSquare,
  BookText,
  GitBranch,
  FileText,
  BarChart3,
  RefreshCw,
  Sparkles,
  ArrowUp,
  Bot,
  User,
  ArrowRight,
  Circle,
  Mic,
  MicOff,
  Copy,
  Volume2,
  Check,
  X,
  Anchor,
  Paperclip,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import type { Activity } from "@/components/activity/ActivityFeed";
import { SourceDocsManager } from "@/components/sources/SourceDocsManager";
import { TeacherDashboard } from "@/components/dashboard/TeacherDashboard";
import type { UserRole, ViewTab } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CenterStageProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  userRole: UserRole;
  activities: Activity[];
  onActivitiesChange: (activities: Activity[]) => void;
  onExpandActivity: (id: string) => void;
}

interface ChatContextItem {
  claimId: string;
  claimTitle: string;
  pageTitle: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  context?: ChatContextItem[];
}

// ── Wiki data ─────────────────────────────────────────────────────────────────

interface WikiClaim {
  id: string;
  title: string;
  description: string;
  anchors: string[];
}

interface WikiPage {
  id: string;
  title: string;
  aliases: string[];
  snippet: string;
  updated: string;
  claims: WikiClaim[];
}

let _wikiCounter = 200;

const INITIAL_WIKI_PAGES: WikiPage[] = [
  {
    id: "ge",
    title: "Gaussian Elimination",
    aliases: ["Row Elimination", "Forward Elimination", "GE"],
    snippet:
      "An algorithm for solving systems of linear equations. It consists of forward elimination to reach row echelon form, followed by back substitution.",
    updated: "Sep 16",
    claims: [
      {
        id: "claim_ge_01",
        title: "Forward Elimination Reduces to REF",
        description:
          "Gaussian elimination's forward phase systematically creates zeros below each pivot, transforming the augmented matrix into row echelon form.",
        anchors: ["Lay §1.2 p.23", "lecture-03-slides.pdf"],
      },
      {
        id: "claim_ge_02",
        title: "Back Substitution Yields Unique Solution",
        description:
          "Once in REF, the system is solved bottom-up by substituting known values into each successive equation.",
        anchors: ["Lay §1.2 p.25"],
      },
      {
        id: "claim_ge_03",
        title: "Partial Pivoting Prevents Numerical Instability",
        description:
          "Selecting the largest absolute value in each column as pivot keeps multipliers bounded, preventing catastrophic floating-point error amplification.",
        anchors: ["Trefethen & Bau §20", "lecture-04-notes.pdf"],
      },
    ],
  },
  {
    id: "rr",
    title: "Row Reduction & Echelon Forms",
    aliases: ["EROs", "RREF", "Row Operations"],
    snippet:
      "Systematic methods for transforming matrices using elementary row operations. A matrix is in REF when all zero rows are at the bottom and each pivot is to the right of the one above.",
    updated: "Sep 15",
    claims: [
      {
        id: "claim_rr_01",
        title: "Three Elementary Row Operations",
        description:
          "The three EROs — row swap, scalar multiplication, and row addition — are the only permitted transformations. Each is reversible.",
        anchors: ["Lay §1.1 p.6"],
      },
      {
        id: "claim_rr_02",
        title: "EROs Preserve the Solution Set",
        description:
          "Applying any elementary row operation to an augmented matrix produces an equivalent system with the same solution set.",
        anchors: ["Lay §1.1 p.8", "lecture-02-proof.pdf"],
      },
      {
        id: "claim_rr_03",
        title: "RREF Is Unique",
        description:
          "Every matrix has exactly one reduced row echelon form, making RREF a canonical representation for determining solution structure.",
        anchors: ["Lay §1.2 Theorem 1"],
      },
    ],
  },
  {
    id: "mi",
    title: "Matrix Inverses",
    aliases: ["Invertible Matrices", "Nonsingular Matrices"],
    snippet:
      "A square matrix A is invertible if there exists a matrix B such that AB = BA = I. The inverse can be computed by augmenting [A|I] and row-reducing.",
    updated: "Sep 14",
    claims: [
      {
        id: "claim_mi_01",
        title: "Invertibility Requires Square and Full Rank",
        description:
          "Only square matrices can be invertible, and they must have full rank — every row and column contains a pivot in RREF.",
        anchors: ["Lay §2.2 p.104"],
      },
      {
        id: "claim_mi_02",
        title: "Augmented Row Reduction Computes A⁻¹",
        description:
          "To find A⁻¹, augment A with I and row-reduce: [A|I] → [I|A⁻¹]. If A is singular, the left side won't reduce to I.",
        anchors: ["Lay §2.2 p.109", "lecture-06-demo.py"],
      },
    ],
  },
  {
    id: "det",
    title: "Determinants",
    aliases: ["det(A)", "Matrix Determinant"],
    snippet:
      "The determinant is a scalar value that encodes properties of a square matrix. A matrix is invertible if and only if its determinant is nonzero.",
    updated: "Sep 13",
    claims: [
      {
        id: "claim_det_01",
        title: "Cofactor Expansion",
        description:
          "The determinant can be computed by expanding along any row or column, summing the products of entries and their cofactors with alternating signs.",
        anchors: ["Lay §3.1 p.167"],
      },
      {
        id: "claim_det_02",
        title: "det(A) = 0 iff A is Singular",
        description:
          "A square matrix is invertible if and only if its determinant is nonzero. Zero determinant means the column vectors are linearly dependent.",
        anchors: ["Lay §3.2 Theorem 4"],
      },
    ],
  },
  {
    id: "vs",
    title: "Vector Spaces",
    aliases: ["Linear Spaces", "Subspaces"],
    snippet:
      "A vector space is a set equipped with vector addition and scalar multiplication satisfying eight axioms. Subspaces are subsets that are themselves vector spaces.",
    updated: "Sep 12",
    claims: [
      {
        id: "claim_vs_01",
        title: "Eight Vector Space Axioms",
        description:
          "Closure, associativity, commutativity of addition, existence of zero vector and additive inverses, plus distributive and scalar identity laws.",
        anchors: ["Lay §4.1 p.192"],
      },
      {
        id: "claim_vs_02",
        title: "Subspace Test",
        description:
          "A subset H of V is a subspace if it contains the zero vector and is closed under addition and scalar multiplication.",
        anchors: ["Lay §4.1 p.195"],
      },
    ],
  },
  {
    id: "eig",
    title: "Eigenvalues",
    aliases: ["Eigenvectors", "Spectral Theory", "Eigendecomposition"],
    snippet:
      "An eigenvalue λ of matrix A satisfies Ax = λx for some nonzero eigenvector x. Eigenvalues reveal fundamental properties of linear transformations.",
    updated: "Sep 11",
    claims: [
      {
        id: "claim_eig_01",
        title: "Characteristic Equation",
        description:
          "Eigenvalues are the roots of det(A − λI) = 0. This polynomial of degree n has at most n roots counting multiplicity.",
        anchors: ["Lay §5.2 p.277"],
      },
      {
        id: "claim_eig_02",
        title: "Eigenspace Is a Subspace",
        description:
          "For each eigenvalue λ, the set of all eigenvectors plus the zero vector forms a subspace called the eigenspace.",
        anchors: ["Lay §5.1 p.271"],
      },
    ],
  },
  {
    id: "svd",
    title: "SVD",
    aliases: ["Singular Value Decomposition", "A = UΣVᵀ"],
    snippet:
      "The SVD factors any m×n matrix A into UΣVᵀ where U and V are orthogonal and Σ is diagonal with nonnegative singular values.",
    updated: "Sep 10",
    claims: [
      {
        id: "claim_svd_01",
        title: "Every Matrix Has an SVD",
        description:
          "Unlike eigendecomposition, the SVD exists for any m×n matrix, not just square or diagonalizable ones.",
        anchors: ["Lay §7.4 p.408"],
      },
      {
        id: "claim_svd_02",
        title: "Low-Rank Approximation via Truncated SVD",
        description:
          "The best rank-k approximation of A in Frobenius norm is obtained by keeping only the k largest singular values.",
        anchors: ["Lay §7.4 p.414", "pca-connection-notes.pdf"],
      },
    ],
  },
  {
    id: "orth",
    title: "Orthogonality",
    aliases: ["Orthogonal Vectors", "Gram-Schmidt", "QR Factorization"],
    snippet:
      "Two vectors are orthogonal if their dot product is zero. Orthogonal bases simplify projections, decompositions, and least-squares problems.",
    updated: "Sep 9",
    claims: [
      {
        id: "claim_orth_01",
        title: "Orthogonal Projection Formula",
        description:
          "The projection of y onto subspace W with orthonormal basis {u₁,…,uₖ} is proj_W(y) = Σ(y·uᵢ)uᵢ.",
        anchors: ["Lay §6.3 p.341"],
      },
      {
        id: "claim_orth_02",
        title: "Gram-Schmidt Produces Orthonormal Basis",
        description:
          "The Gram-Schmidt process takes any linearly independent set and produces an orthonormal set spanning the same subspace.",
        anchors: ["Lay §6.4 p.349"],
      },
    ],
  },
];

// ── Node map data ─────────────────────────────────────────────────────────────

interface DemoNode {
  id: string;
  label: string;
  x: number;
  y: number;
  mastery: number;
  deps: string[];
}

const DEMO_NODES: DemoNode[] = [
  { id: "rr", label: "Row Reduction", x: 150, y: 60, mastery: 100, deps: [] },
  { id: "ge", label: "Gaussian Elim.", x: 400, y: 60, mastery: 67, deps: ["rr"] },
  { id: "mi", label: "Matrix Inverses", x: 650, y: 60, mastery: 25, deps: ["ge"] },
  { id: "det", label: "Determinants", x: 400, y: 180, mastery: 15, deps: ["ge"] },
  { id: "vs", label: "Vector Spaces", x: 150, y: 180, mastery: 40, deps: ["rr"] },
  { id: "eig", label: "Eigenvalues", x: 650, y: 180, mastery: 10, deps: ["det", "mi"] },
  { id: "svd", label: "SVD", x: 650, y: 300, mastery: 5, deps: ["eig"] },
  { id: "orth", label: "Orthogonality", x: 400, y: 300, mastery: 30, deps: ["vs", "det"] },
];

// ── Chat seed data ────────────────────────────────────────────────────────────

const SEED_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    text: "Can you explain why we need partial pivoting in Gaussian elimination?",
    time: "2:14 PM",
  },
  {
    id: "m2",
    role: "assistant",
    text: "Great question! Without partial pivoting, Gaussian elimination can produce wildly inaccurate results due to floating-point errors.\n\nHere's the core issue: when you divide by a very small pivot element, the multipliers become very large. Those large multipliers amplify any rounding errors in subsequent operations.\n\nPartial pivoting fixes this by always choosing the largest absolute value in the current column as the pivot. This keeps multipliers ≤ 1, which bounds the error growth.\n\nFor example, consider the system:\n  0.001x + y = 1\n  x + y = 2\n\nWithout pivoting, dividing by 0.001 creates a multiplier of 1000, and floating-point arithmetic can give x ≈ 0, y ≈ 1 — very wrong. Swapping rows first gives the correct answer.",
    time: "2:14 PM",
  },
  {
    id: "m3",
    role: "user",
    text: "What about complete pivoting? Is it ever used in practice?",
    time: "2:15 PM",
  },
  {
    id: "m4",
    role: "assistant",
    text: "Complete pivoting searches both rows AND columns for the largest element, not just the current column. It provides better numerical stability in theory, but it's rarely used in practice for two reasons:\n\n1. **Cost**: It requires O(n²) comparisons per step instead of O(n) for partial pivoting — that adds up for large matrices.\n\n2. **Diminishing returns**: Partial pivoting is already \"good enough\" for nearly all practical problems. The improvement from complete pivoting is marginal.\n\nThe one exception is when you need to determine the numerical rank of a matrix. Complete pivoting (or its variant, rook pivoting) is more reliable for rank-revealing factorizations.",
    time: "2:15 PM",
  },
];

let _msgId = 100;

function ts() {
  return new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export function CenterStage({
  activeTab,
  onTabChange,
  userRole,
  activities,
  onActivitiesChange,
  onExpandActivity,
}: CenterStageProps) {
  const isTeacher = userRole === "teacher";
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [chatContext, setChatContext] = useState<ChatContextItem[]>([]);
  const [wikiPages, setWikiPages] = useState<WikiPage[]>(INITIAL_WIKI_PAGES);
  const [wikiPageId, setWikiPageId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    if (activeTab === "chat") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTab]);

  const addClaimContext = useCallback((claim: WikiClaim, pageTitle: string) => {
    setChatContext((prev) => {
      if (prev.some((c) => c.claimId === claim.id)) return prev;
      return [
        ...prev,
        { claimId: claim.id, claimTitle: claim.title, pageTitle },
      ];
    });
  }, []);

  const removeClaimContext = useCallback((claimId: string) => {
    setChatContext((prev) => prev.filter((c) => c.claimId !== claimId));
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const page = wikiPages.find((p) => p.id === nodeId);
      if (page) {
        setWikiPageId(page.id);
        onTabChange("wiki");
      }
    },
    [onTabChange, wikiPages]
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      if (activeTab !== "chat") {
        setMessages([]);
        onTabChange("chat");
      }

      const userMsg: ChatMessage = {
        id: `m${++_msgId}`,
        role: "user",
        text: text.trim(),
        time: ts(),
        context: chatContext.length > 0 ? [...chatContext] : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setChatContext([]);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `m${++_msgId}`,
            role: "assistant",
            text: "I'm processing your question. In production, this would call the Axiom backend using Amazon Bedrock to generate a contextual response based on your knowledge graph and learning progress.",
            time: ts(),
          },
        ]);
      }, 1500);
    },
    [activeTab, onTabChange, chatContext]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recRef.current?.stop();
      setIsListening(false);
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
        setInput(
          (prev) => prev + (prev ? " " : "") + e.results[0][0].transcript
        );
        setIsListening(false);
      };
      rec.onerror = () => setIsListening(false);
      rec.onend = () => setIsListening(false);
      recRef.current = rec;
      rec.start();
      setIsListening(true);
    } catch {
      // browser does not support speech recognition
    }
  }, [isListening]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
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
              Chat
            </TabsTrigger>
            <TabsTrigger value="wiki" className="gap-1.5">
              <BookText className="h-3.5 w-3.5" />
              Wiki
            </TabsTrigger>
            <TabsTrigger value="nodemap" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Node Map
            </TabsTrigger>
            <TabsTrigger value="sources" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Source Docs
            </TabsTrigger>
            {isTeacher && (
              <TabsTrigger value="dashboard" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Dashboard
              </TabsTrigger>
            )}
          </TabsList>
          <button className="px-3 text-muted-foreground transition-colors hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* ── Tab content ──────────────────────────────────────────────── */}

        <TabsContent value="activity" className="flex-1 overflow-y-auto">
          <ActivityFeed
              activities={activities}
              onActivitiesChange={onActivitiesChange}
              onExpandActivity={onExpandActivity}
            />
        </TabsContent>

        <TabsContent value="chat" className="flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <MessageSquare className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">No messages yet</p>
                  <p className="mt-1 text-xs">
                    Type below to start a conversation
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <ChatBubble key={msg.id} message={msg} />
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="wiki" className="flex-1 overflow-y-auto">
          <DemoWikiTab
            pages={wikiPages}
            onPagesChange={setWikiPages}
            selectedPageId={wikiPageId}
            onSelectPage={setWikiPageId}
            onClaimClick={addClaimContext}
            isTeacher={isTeacher}
          />
        </TabsContent>

        <TabsContent value="nodemap" className="flex-1 overflow-y-auto">
          <DemoNodeMapTab onNodeClick={handleNodeClick} />
        </TabsContent>

        <TabsContent value="sources" className="flex-1 overflow-y-auto">
          <SourceDocsManager />
        </TabsContent>

        {isTeacher && (
          <TabsContent value="dashboard" className="flex-1 overflow-y-auto">
            <TeacherDashboard />
          </TabsContent>
        )}
      </Tabs>

      {/* ── Shared bottom input bar ──────────────────────────────────── */}

      <div className="border-t px-5 py-3">
        {/* Context chips */}
        {chatContext.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chatContext.map((ctx) => (
              <span
                key={ctx.claimId}
                className="inline-flex items-center gap-1.5 rounded-md border bg-primary/5 px-2.5 py-1 text-xs"
              >
                <Paperclip className="h-3 w-3 text-primary" />
                <span className="max-w-[200px] truncate font-medium">
                  {ctx.claimTitle}
                </span>
                <button
                  onClick={() => removeClaimContext(ctx.claimId)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeTab === "chat"
                ? "Type a message..."
                : "Ask a question, request a hint, or search Axiom vaults..."
            }
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={toggleVoice}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              isListening
                ? "animate-pulse bg-red-500 text-white"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            title={isListening ? "Stop listening" : "Voice input"}
          >
            {isListening ? (
              <MicOff className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() && chatContext.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Chat Bubble ───────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const handleReadAloud = () => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.text);
    window.speechSynthesis.speak(utterance);
  };

  const isUser = message.role === "user";

  return (
    <div
      className={`group relative flex gap-3 ${isUser ? "justify-end" : ""}`}
    >
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className="relative max-w-[75%]">
        {/* Hover action menu */}
        <div
          className={`absolute -top-8 ${
            isUser ? "right-0" : "left-0"
          } z-10 hidden items-center gap-0.5 rounded-md border bg-popover px-1 py-0.5 shadow-sm group-hover:flex`}
        >
          <button
            onClick={handleCopy}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Copy"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={handleReadAloud}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Read aloud"
          >
            <Volume2 className="h-3 w-3" />
          </button>
        </div>

        {/* Context references */}
        {message.context && message.context.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {message.context.map((ctx) => (
              <span
                key={ctx.claimId}
                className="inline-flex items-center gap-1 rounded border bg-primary/5 px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <Paperclip className="h-2.5 w-2.5" />
                {ctx.claimTitle}
              </span>
            ))}
          </div>
        )}

        {/* Bubble content */}
        <div
          className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "border bg-card"
          }`}
        >
          {message.text.split("\n").map((line, j) => (
            <p key={j} className={j > 0 ? "mt-2" : ""}>
              {line}
            </p>
          ))}
          <p
            className={`mt-2 text-[10px] ${
              isUser
                ? "text-primary-foreground/60"
                : "text-muted-foreground"
            }`}
          >
            {message.time}
          </p>
        </div>
      </div>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ── Demo Wiki Tab ─────────────────────────────────────────────────────────────

interface DemoWikiTabProps {
  pages: WikiPage[];
  onPagesChange: (pages: WikiPage[]) => void;
  selectedPageId: string | null;
  onSelectPage: (id: string | null) => void;
  onClaimClick: (claim: WikiClaim, pageTitle: string) => void;
  isTeacher: boolean;
}

type WikiMode =
  | "view"
  | "create-page"
  | "edit-page"
  | "create-claim"
  | "edit-claim";

function DemoWikiTab({
  pages,
  onPagesChange,
  selectedPageId,
  onSelectPage,
  onClaimClick,
  isTeacher,
}: DemoWikiTabProps) {
  const [mode, setMode] = useState<WikiMode>("view");
  const [editClaimId, setEditClaimId] = useState<string | null>(null);

  // Form fields
  const [fTitle, setFTitle] = useState("");
  const [fAliases, setFAliases] = useState("");
  const [fSnippet, setFSnippet] = useState("");
  const [fCTitle, setFCTitle] = useState("");
  const [fCDesc, setFCDesc] = useState("");
  const [fCAnchors, setFCAnchors] = useState("");

  const page = pages.find((p) => p.id === selectedPageId);

  const todayStr = () =>
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  const parseCSV = (s: string) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  // ── Page CRUD ─────────────────────────────────────────────────────────────

  const startCreatePage = () => {
    setFTitle("");
    setFAliases("");
    setFSnippet("");
    setMode("create-page");
  };

  const startEditPage = () => {
    if (!page) return;
    setFTitle(page.title);
    setFAliases(page.aliases.join(", "));
    setFSnippet(page.snippet);
    setMode("edit-page");
  };

  const savePage = () => {
    if (!fTitle.trim()) return;
    if (mode === "create-page") {
      const id = `wiki_${++_wikiCounter}`;
      const newPage: WikiPage = {
        id,
        title: fTitle.trim(),
        aliases: parseCSV(fAliases),
        snippet: fSnippet.trim(),
        updated: todayStr(),
        claims: [],
      };
      onPagesChange([...pages, newPage]);
      onSelectPage(id);
    } else if (mode === "edit-page" && page) {
      onPagesChange(
        pages.map((p) =>
          p.id === page.id
            ? {
                ...p,
                title: fTitle.trim(),
                aliases: parseCSV(fAliases),
                snippet: fSnippet.trim(),
                updated: todayStr(),
              }
            : p
        )
      );
    }
    setMode("view");
  };

  const deletePage = (id: string) => {
    onPagesChange(pages.filter((p) => p.id !== id));
    if (selectedPageId === id) onSelectPage(null);
  };

  // ── Claim CRUD ────────────────────────────────────────────────────────────

  const startCreateClaim = () => {
    setFCTitle("");
    setFCDesc("");
    setFCAnchors("");
    setMode("create-claim");
  };

  const startEditClaim = (c: WikiClaim) => {
    setEditClaimId(c.id);
    setFCTitle(c.title);
    setFCDesc(c.description);
    setFCAnchors(c.anchors.join(", "));
    setMode("edit-claim");
  };

  const saveClaim = () => {
    if (!page || !fCTitle.trim()) return;
    const data = {
      title: fCTitle.trim(),
      description: fCDesc.trim(),
      anchors: parseCSV(fCAnchors),
    };
    if (mode === "create-claim") {
      const newClaim: WikiClaim = {
        id: `claim_${++_wikiCounter}`,
        ...data,
      };
      onPagesChange(
        pages.map((p) =>
          p.id === page.id
            ? { ...p, claims: [...p.claims, newClaim] }
            : p
        )
      );
    } else if (mode === "edit-claim" && editClaimId) {
      onPagesChange(
        pages.map((p) =>
          p.id === page.id
            ? {
                ...p,
                claims: p.claims.map((c) =>
                  c.id === editClaimId ? { ...c, ...data } : c
                ),
              }
            : p
        )
      );
    }
    setMode("view");
    setEditClaimId(null);
  };

  const deleteClaim = (claimId: string) => {
    if (!page) return;
    onPagesChange(
      pages.map((p) =>
        p.id === page.id
          ? { ...p, claims: p.claims.filter((c) => c.id !== claimId) }
          : p
      )
    );
  };

  // ── Shared form components ────────────────────────────────────────────────

  const inputCls =
    "w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  const PageForm = () => (
    <div className="mb-4 rounded-lg border bg-card px-5 py-4">
      <p className="mb-3 text-sm font-semibold">
        {mode === "create-page" ? "New Wiki Page" : "Edit Wiki Page"}
      </p>
      <div className="space-y-3">
        <input
          className={inputCls}
          placeholder="Page title"
          value={fTitle}
          onChange={(e) => setFTitle(e.target.value)}
          autoFocus
        />
        <input
          className={inputCls}
          placeholder="Aliases (comma-separated)"
          value={fAliases}
          onChange={(e) => setFAliases(e.target.value)}
        />
        <textarea
          className={`${inputCls} min-h-[80px] resize-none`}
          placeholder="Description / summary"
          value={fSnippet}
          onChange={(e) => setFSnippet(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setMode("view")}
            className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={savePage}
            disabled={!fTitle.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  const ClaimForm = () => (
    <div className="mb-3 rounded-lg border bg-card px-5 py-4">
      <p className="mb-3 text-sm font-semibold">
        {mode === "create-claim" ? "New Claim" : "Edit Claim"}
      </p>
      <div className="space-y-3">
        <input
          className={inputCls}
          placeholder="Claim title"
          value={fCTitle}
          onChange={(e) => setFCTitle(e.target.value)}
          autoFocus
        />
        <textarea
          className={`${inputCls} min-h-[60px] resize-none`}
          placeholder="Description"
          value={fCDesc}
          onChange={(e) => setFCDesc(e.target.value)}
          rows={2}
        />
        <input
          className={inputCls}
          placeholder="Anchors / sources (comma-separated)"
          value={fCAnchors}
          onChange={(e) => setFCAnchors(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setMode("view");
              setEditClaimId(null);
            }}
            className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={saveClaim}
            disabled={!fCTitle.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  // ── Detail view ───────────────────────────────────────────────────────────

  if (page) {
    return (
      <div className="px-6 py-5">
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => {
              onSelectPage(null);
              setMode("view");
            }}
            className="text-sm text-primary hover:text-primary/80"
          >
            &larr; Back to all pages
          </button>
          {isTeacher && mode === "view" && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={startEditPage}
                className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              <button
                onClick={() => deletePage(page.id)}
                className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          )}
        </div>

        {(mode === "edit-page" || mode === "create-page") && <PageForm />}

        {mode !== "edit-page" && (
          <>
            <h2 className="text-xl font-bold">{page.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {page.aliases.map((alias) => (
                <span
                  key={alias}
                  className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {alias}
                </span>
              ))}
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {page.claims.length} atomic claims &middot; Updated{" "}
              {page.updated}
            </p>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-foreground/80">
              <p>{page.snippet}</p>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Atomic Claims
                  </p>
                  {isTeacher && mode === "view" && (
                    <button
                      onClick={startCreateClaim}
                      className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Plus className="h-3 w-3" />
                      Add Claim
                    </button>
                  )}
                </div>

                {(mode === "create-claim" || mode === "edit-claim") && (
                  <ClaimForm />
                )}

                {page.claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="group/claim rounded-lg border bg-card px-5 py-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => onClaimClick(claim, page.title)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="text-sm font-semibold text-foreground">
                          {claim.title}
                        </p>
                        <p className="mt-1 text-sm text-foreground/70">
                          {claim.description}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {claim.anchors.map((anchor) => (
                            <span
                              key={anchor}
                              className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                            >
                              <Anchor className="h-2.5 w-2.5" />
                              {anchor}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-[10px] italic text-primary">
                          Click to add to chat context
                        </p>
                      </button>
                      {isTeacher && mode === "view" && (
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/claim:opacity-100">
                          <button
                            onClick={() => startEditClaim(claim)}
                            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Edit claim"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteClaim(claim.id)}
                            className="flex h-7 w-7 items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600"
                            title="Delete claim"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {page.claims.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No claims yet.{" "}
                    {isTeacher && "Click \"Add Claim\" to create one."}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Wiki</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Knowledge base generated from your source documents.
          </p>
        </div>
        {isTeacher && mode === "view" && (
          <button
            onClick={startCreatePage}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Page
          </button>
        )}
      </div>

      {(mode === "create-page" || mode === "edit-page") && (
        <div className="mt-4">
          <PageForm />
        </div>
      )}

      <div className="mt-5 space-y-2">
        {pages.map((wp) => (
          <div
            key={wp.id}
            className="group/row flex w-full items-center gap-4 rounded-lg border bg-card px-5 py-4 transition-colors hover:bg-accent/30"
          >
            <button
              onClick={() => onSelectPage(wp.id)}
              className="flex min-w-0 flex-1 items-center gap-4 text-left"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                <BookText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{wp.title}</p>
                <div className="mt-0.5 flex gap-1">
                  {wp.aliases.slice(0, 3).map((a) => (
                    <span
                      key={a}
                      className="rounded bg-secondary px-1.5 py-0 text-[10px] text-muted-foreground"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs text-muted-foreground">
                  {wp.claims.length} claims
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {wp.updated}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
            {isTeacher && (
              <button
                onClick={() => deletePage(wp.id)}
                className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100"
                title="Delete page"
              >
                <Trash2 className="h-4 w-4 text-red-400 hover:text-red-600" />
              </button>
            )}
          </div>
        ))}
        {pages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No wiki pages yet.{" "}
            {isTeacher && "Click \"New Page\" to get started."}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Demo Node Map Tab ─────────────────────────────────────────────────────────

interface DemoNodeMapTabProps {
  onNodeClick: (nodeId: string) => void;
}

function DemoNodeMapTab({ onNodeClick }: DemoNodeMapTabProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const getColor = (mastery: number) => {
    if (mastery === 100)
      return { fill: "#10b981", stroke: "#059669", text: "#fff" };
    return { fill: "#3b82f6", stroke: "#2563eb", text: "#fff" };
  };

  return (
    <div className="px-6 py-5">
      <h2 className="text-lg font-bold">Knowledge Node Map</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Topic dependency graph. Click a node to view its wiki page.
      </p>
      <div className="mt-5 overflow-auto rounded-xl border bg-card">
        <svg
          viewBox="0 0 850 380"
          className="w-full"
          style={{ minHeight: 380 }}
        >
          {DEMO_NODES.flatMap((node) =>
            node.deps.map((depId) => {
              const dep = DEMO_NODES.find((n) => n.id === depId);
              if (!dep) return null;
              return (
                <line
                  key={`${depId}-${node.id}`}
                  x1={dep.x + 70}
                  y1={dep.y + 22}
                  x2={node.x}
                  y2={node.y + 22}
                  stroke="#cbd5e1"
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                />
              );
            })
          )}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#cbd5e1" />
            </marker>
          </defs>
          {DEMO_NODES.map((node) => {
            const colors = getColor(node.mastery);
            const isHovered = hovered === node.id;
            return (
              <g
                key={node.id}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onNodeClick(node.id)}
                className="cursor-pointer"
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={140}
                  height={44}
                  rx={8}
                  fill={colors.fill}
                  stroke={isHovered ? "#2563eb" : colors.stroke}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                />
                {node.mastery > 0 && node.mastery < 100 && (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={140 * (node.mastery / 100)}
                    height={44}
                    rx={8}
                    fill={colors.fill}
                    opacity={0.3}
                  />
                )}
                <text
                  x={node.x + 70}
                  y={node.y + 24}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fontWeight="600"
                  fontFamily="Inter, system-ui, sans-serif"
                  fill={colors.text}
                >
                  {node.label}
                </text>
                {node.mastery > 0 && (
                  <text
                    x={node.x + 130}
                    y={node.y + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                    fill={colors.text}
                  >
                    {node.mastery}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex items-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-emerald-500 text-emerald-500" />
          Mastered
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-blue-500 text-blue-500" />
          In Progress
        </span>
      </div>
    </div>
  );
}
