"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  MessageSquare,
  BookText,
  Sparkles,
  ArrowUp,
  Bot,
  ArrowRight,
  Circle,
  Mic,
  MicOff,
  Copy,
  Volume2,
  VolumeX,
  Check,
  X,
  Anchor,
  Paperclip,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ZoomIn,
  ZoomOut,
  ImageIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import type { Activity } from "@/components/activity/ActivityFeed";
import { SourceDocsManager } from "@/components/sources/SourceDocsManager";
import { FiguresPage } from "@/components/figures/FiguresPage";
import { TeacherDashboard } from "@/components/dashboard/TeacherDashboard";
import { ClassChatHistory } from "@/components/dashboard/ClassChatHistory";
import type { CompletedActivityReview } from "@/components/activity/CompletedActivityReviewOverlay";
import { GlossaryTab } from "@/components/glossary/GlossaryTab";
import { GlossaryInlineCard } from "@/components/glossary/GlossaryInlineCard";
import type { UserRole, ViewTab, GraphTopic, GraphEdge, Figure } from "@/lib/types";
import {
  createChatSession,
  sendChatMessage,
  uploadChatImage,
  fetchGraph,
  createTopic,
  updateTopic,
  deleteTopic as apiDeleteTopic,
  createClaim as apiCreateClaim,
  updateClaim as apiUpdateClaim,
  deleteClaim as apiDeleteClaim,
  synthesizeSpeech,
  listFiguresByClaim,
  getFigureViewUrl,
} from "@/lib/api";
import FigureLightbox from "@/components/figures/FigureLightbox";
import { SettingsPage, parseAvatar } from "@/components/settings/SettingsPage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  backendId?: number;
  title: string;
  messages: ChatMessage[];
}

export const SEED_SESSION: ChatSession = {
  id: "seed",
  title: "Gaussian Elimination",
  messages: [],
};

interface CenterStageProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  userRole: UserRole;
  userId: string;
  activities: Activity[];
  onActivitiesChange: (activities: Activity[]) => void;
  onExpandActivity: (id: string) => void;
  wikiPages: WikiPage[];
  onWikiPagesChange: React.Dispatch<React.SetStateAction<WikiPage[]>>;
  wikiPageId: string | null;
  onWikiPageSelect: (id: string | null) => void;
  pendingChatMessage?: { text: string; title?: string } | null;
  onPendingChatMessageHandled?: () => void;
  sessions: ChatSession[];
  onSessionsChange: (sessions: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])) => void;
  activeSessionId: string | null;
  onActiveSessionIdChange: (id: string | null) => void;
  onDeleteSession: (id: string) => void;
  user: import("@/lib/types").UserProfile;
  settings: import("@/hooks/use-settings").AppSettings;
  onUpdateProfile: (patch: Partial<import("@/lib/types").UserProfile>) => void;
  onUpdateSetting: <K extends keyof import("@/hooks/use-settings").AppSettings>(key: K, value: import("@/hooks/use-settings").AppSettings[K]) => void;
  onReviewActivity?: (review: CompletedActivityReview) => void;
  onViewSource?: (sourceDocumentId: string) => void;
  pendingSourceDocId?: string | null;
  onPendingSourceDocHandled?: () => void;
}

interface ChatContextItem {
  type?: "claim" | "activity";
  claimId: string;
  claimTitle: string;
  pageTitle: string;
  description?: string;
}

interface StagedImage {
  file: File;
  previewUrl: string;
  s3Key: string | null;
  uploading: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  context?: ChatContextItem[];
  sources?: Record<string, any> | null;
  imageUrls?: string[];
}

// ── Wiki data ─────────────────────────────────────────────────────────────────

export interface WikiClaim {
  id: string;
  title: string;
  description: string;
  anchors: string[];
  sourceDocumentId?: string | null;
}

export interface WikiPage {
  id: string;
  title: string;
  aliases: string[];
  snippet: string;
  updated: string;
  claims: WikiClaim[];
}

let _wikiCounter = 200;

export const INITIAL_WIKI_PAGES: WikiPage[] = [
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_ge_02",
        title: "Back Substitution Yields Unique Solution",
        description:
          "Once in REF, the system is solved bottom-up by substituting known values into each successive equation.",
        anchors: ["Lay §1.2 p.25"],
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_ge_03",
        title: "Partial Pivoting Prevents Numerical Instability",
        description:
          "Selecting the largest absolute value in each column as pivot keeps multipliers bounded, preventing catastrophic floating-point error amplification.",
        anchors: ["Trefethen & Bau §20", "lecture-04-notes.pdf"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_rr_02",
        title: "EROs Preserve the Solution Set",
        description:
          "Applying any elementary row operation to an augmented matrix produces an equivalent system with the same solution set.",
        anchors: ["Lay §1.1 p.8", "lecture-02-proof.pdf"],
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_rr_03",
        title: "RREF Is Unique",
        description:
          "Every matrix has exactly one reduced row echelon form, making RREF a canonical representation for determining solution structure.",
        anchors: ["Lay §1.2 Theorem 1"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_mi_02",
        title: "Augmented Row Reduction Computes A⁻¹",
        description:
          "To find A⁻¹, augment A with I and row-reduce: [A|I] → [I|A⁻¹]. If A is singular, the left side won't reduce to I.",
        anchors: ["Lay §2.2 p.109", "lecture-06-demo.py"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_det_02",
        title: "det(A) = 0 iff A is Singular",
        description:
          "A square matrix is invertible if and only if its determinant is nonzero. Zero determinant means the column vectors are linearly dependent.",
        anchors: ["Lay §3.2 Theorem 4"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_vs_02",
        title: "Subspace Test",
        description:
          "A subset H of V is a subspace if it contains the zero vector and is closed under addition and scalar multiplication.",
        anchors: ["Lay §4.1 p.195"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_eig_02",
        title: "Eigenspace Is a Subspace",
        description:
          "For each eigenvalue λ, the set of all eigenvectors plus the zero vector forms a subspace called the eigenspace.",
        anchors: ["Lay §5.1 p.271"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_svd_02",
        title: "Low-Rank Approximation via Truncated SVD",
        description:
          "The best rank-k approximation of A in Frobenius norm is obtained by keeping only the k largest singular values.",
        anchors: ["Lay §7.4 p.414", "pca-connection-notes.pdf"],
        sourceDocumentId: "doc_linear_algebra",
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
        sourceDocumentId: "doc_linear_algebra",
      },
      {
        id: "claim_orth_02",
        title: "Gram-Schmidt Produces Orthonormal Basis",
        description:
          "The Gram-Schmidt process takes any linearly independent set and produces an orthonormal set spanning the same subspace.",
        anchors: ["Lay §6.4 p.349"],
        sourceDocumentId: "doc_linear_algebra",
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
  complexity?: number | null;
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

function computeNodeLayout(topics: GraphTopic[], edges: GraphEdge[]): DemoNode[] {
  const depMap = new Map<string, string[]>();
  for (const e of edges) {
    const existing = depMap.get(e.to_id) ?? [];
    existing.push(e.from_id);
    depMap.set(e.to_id, existing);
  }
  const cols = 3;
  return topics.map((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const mastery =
      t.claim_count > 0
        ? Math.round((t.mastered_count / t.claim_count) * 100)
        : 0;
    return {
      id: t.topic_id,
      label: (t.title ?? t.slug ?? t.topic_id).slice(0, 18),
      x: 150 + col * 250,
      y: 60 + row * 120,
      mastery,
      complexity: t.complexity_score,
      deps: depMap.get(t.topic_id) ?? [],
    };
  });
}

const NODE_W = 140;
const NODE_H = 44;
const NODE_RX = NODE_H / 2;

function simulateForces(nodes: DemoNode[], iterations = 150): DemoNode[] {
  const sim = nodes.map((n, i) => ({
    ...n,
    x: n.x + ((((i * 7 + 13) * 2654435761) >>> 0) % 60 - 30),
    y: n.y + ((((i * 11 + 37) * 2654435761) >>> 0) % 60 - 30),
    vx: 0,
    vy: 0,
  }));

  const cx = sim.reduce((s, n) => s + n.x, 0) / sim.length + NODE_W / 2;
  const cy = sim.reduce((s, n) => s + n.y, 0) / sim.length + NODE_H / 2;

  for (let i = 0; i < iterations; i++) {
    const alpha = 1 - i / iterations;

    for (let a = 0; a < sim.length; a++) {
      for (let b = a + 1; b < sim.length; b++) {
        const dx = sim[b].x - sim[a].x;
        const dy = sim[b].y - sim[a].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 8000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        sim[a].vx -= fx;
        sim[a].vy -= fy;
        sim[b].vx += fx;
        sim[b].vy += fy;
      }
    }

    for (const node of sim) {
      for (const depId of node.deps) {
        const dep = sim.find((n) => n.id === depId);
        if (!dep) continue;
        const dx = dep.x - node.x;
        const dy = dep.y - node.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 200) * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        node.vx += fx;
        node.vy += fy;
        dep.vx -= fx;
        dep.vy -= fy;
      }
    }

    for (const node of sim) {
      node.vx += (cx - node.x) * 0.01;
      node.vy += (cy - node.y) * 0.01;
    }

    for (const node of sim) {
      node.vx *= 0.8;
      node.vy *= 0.8;
      node.x += node.vx * alpha;
      node.y += node.vy * alpha;
    }
  }

  const PAD = 60;
  const minX = Math.min(...sim.map((n) => n.x));
  const minY = Math.min(...sim.map((n) => n.y));
  const shiftX = PAD - minX;
  const shiftY = PAD - minY;
  for (const node of sim) {
    node.x += shiftX;
    node.y += shiftY;
  }

  return sim.map(({ vx, vy, ...rest }) => rest);
}

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
  userId,
  activities,
  onActivitiesChange,
  onExpandActivity,
  wikiPages,
  onWikiPagesChange,
  wikiPageId,
  onWikiPageSelect,
  pendingChatMessage,
  onPendingChatMessageHandled,
  sessions,
  onSessionsChange,
  activeSessionId,
  onActiveSessionIdChange,
  onDeleteSession,
  user: userProfile,
  settings,
  onUpdateProfile,
  onUpdateSetting,
  onReviewActivity,
  onViewSource,
  pendingSourceDocId,
  onPendingSourceDocHandled,
}: CenterStageProps) {
  const isTeacher = userRole === "teacher";
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [chatContext, setChatContext] = useState<ChatContextItem[]>([]);
  const [graphNodes, setGraphNodes] = useState<DemoNode[]>(DEMO_NODES);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    if (activeTab === "chat") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTab]);

  // ── Load graph data from API ───────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    fetchGraph(userId)
      .then((data) => {
        if (data.topics.length > 0) {
          setGraphNodes(computeNodeLayout(data.topics, data.edges));
        }
      })
      .catch((err) => console.error("CenterStage: failed to fetch graph data:", err));
  }, [userId]);

  const addClaimContext = useCallback((claim: WikiClaim, pageTitle: string) => {
    setChatContext((prev) => {
      if (prev.some((c) => c.claimId === claim.id)) return prev;
      return [
        ...prev,
        { claimId: claim.id, claimTitle: claim.title, pageTitle, description: claim.description },
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
        onWikiPageSelect(page.id);
        onTabChange("wiki");
      }
    },
    [onTabChange, wikiPages, onWikiPageSelect]
  );

  const stageImageFile = useCallback(
    async (file: File, backendSessionId?: number) => {
      const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      if (!ALLOWED.includes(file.type)) return;
      if (file.size > 3_750_000) return;

      const previewUrl = URL.createObjectURL(file);
      const entry: StagedImage = { file, previewUrl, s3Key: null, uploading: true };
      setStagedImages((prev) => [...prev, entry]);

      const sessionBackendId =
        backendSessionId ??
        sessions.find((s) => s.id === activeSessionId)?.backendId;

      if (sessionBackendId) {
        try {
          const result = await uploadChatImage(userId, sessionBackendId, file);
          setStagedImages((prev) =>
            prev.map((img) =>
              img.previewUrl === previewUrl
                ? { ...img, s3Key: result.s3_key, uploading: false }
                : img
            )
          );
        } catch (err) {
          console.error("CenterStage: image upload failed:", err);
          setStagedImages((prev) => prev.filter((img) => img.previewUrl !== previewUrl));
          URL.revokeObjectURL(previewUrl);
        }
      } else {
        setStagedImages((prev) =>
          prev.map((img) =>
            img.previewUrl === previewUrl ? { ...img, uploading: false } : img
          )
        );
      }
    },
    [userId, sessions, activeSessionId]
  );

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      Array.from(files).forEach((f) => stageImageFile(f));
      e.target.value = "";
    },
    [stageImageFile]
  );

  const removeStagedImage = useCallback((previewUrl: string) => {
    setStagedImages((prev) => prev.filter((img) => img.previewUrl !== previewUrl));
    URL.revokeObjectURL(previewUrl);
  }, []);

  const createNewSession = useCallback(
    async (title?: string) => {
      const localId = `chat_${++_msgId}`;
      const newSession: ChatSession = {
        id: localId,
        title: title ?? "New Chat",
        messages: [],
      };
      onSessionsChange([...sessions, newSession]);
      onActiveSessionIdChange(localId);
      setMessages([]);

      try {
        const backendSession = await createChatSession(userId, title);
        const updated = { ...newSession, backendId: backendSession.id };
        onSessionsChange((prev: ChatSession[]) =>
          prev.map((s) => (s.id === localId ? updated : s))
        );
      } catch (err) {
        console.error("CenterStage: failed to create backend chat session:", err);
      }
    },
    [sessions, onSessionsChange, onActiveSessionIdChange, userId]
  );

  const sendMessage = useCallback(
    async (text: string, forceNewSession = false, sessionTitle?: string) => {
      const contextParts = chatContext.map((c) => {
        if (c.type === "activity") return c.pageTitle;
        return `[Axiom — "${c.claimTitle}" from ${c.pageTitle}: ${c.description ?? c.claimTitle}]`;
      });
      const contextPrefix = contextParts.join("\n\n");
      const fullText = contextPrefix ? (text.trim() ? `${contextPrefix}\n\n${text.trim()}` : contextPrefix) : text.trim();

      const currentImages = [...stagedImages];
      const imageKeys = currentImages.filter((img) => img.s3Key).map((img) => img.s3Key!);
      const imagePreviewUrls = currentImages.map((img) => img.previewUrl);

      if (!fullText && imageKeys.length === 0) return;

      const messageText = fullText || "Please look at this image";
      setStagedImages([]);
      const title = sessionTitle ?? text.trim().slice(0, 40);
      let targetSessionId = activeSessionId;

      if (forceNewSession || activeTab !== "chat") {
        const localId = `chat_${++_msgId}`;
        const newSession: ChatSession = {
          id: localId,
          title,
          messages: [],
        };
        onSessionsChange([...sessions, newSession]);
        onActiveSessionIdChange(localId);
        targetSessionId = localId;
        setMessages([]);
        onTabChange("chat");

        try {
          const backendSession = await createChatSession(
            userId,
            title
          );
          onSessionsChange((prev: ChatSession[]) =>
            prev.map((s) =>
              s.id === localId ? { ...s, backendId: backendSession.id } : s
            )
          );

          // Upload any images that didn't have a backend session yet
          const uploadedKeys = [...imageKeys];
          for (const img of currentImages) {
            if (!img.s3Key && img.file) {
              try {
                const result = await uploadChatImage(userId, backendSession.id, img.file);
                uploadedKeys.push(result.s3_key);
              } catch (err) {
                console.error("CenterStage: late image upload failed:", err);
              }
            }
          }

          // Use backend session for sending message
          const userMsg: ChatMessage = {
            id: `m${++_msgId}`,
            role: "user",
            text: messageText,
            time: ts(),
            context: chatContext.length > 0 ? [...chatContext] : undefined,
            imageUrls: imagePreviewUrls.length > 0 ? imagePreviewUrls : undefined,
          };
          setMessages((prev) => [...prev, userMsg]);
          setInput("");
          setChatContext([]);
          setIsTyping(true);

          try {
            const reply = await sendChatMessage(
              userId,
              backendSession.id,
              messageText,
              uploadedKeys.length > 0 ? uploadedKeys : undefined
            );
            setMessages((prev) => [
              ...prev,
              {
                id: `m${++_msgId}`,
                role: "assistant",
                text: reply.content,
                time: ts(),
                sources: reply.sources,
              },
            ]);
          } catch (err) {
            console.error("CenterStage: failed to send chat message:", err);
            setMessages((prev) => [
              ...prev,
              {
                id: `m${++_msgId}`,
                role: "assistant",
                text: "I'm processing your question. The backend may be starting up — please try again in a moment.",
                time: ts(),
              },
            ]);
          } finally {
            setIsTyping(false);
          }
          return;
        } catch (err) {
          console.error("CenterStage: failed to create session for new chat:", err);
        }
      }

      const userMsg: ChatMessage = {
        id: `m${++_msgId}`,
        role: "user",
        text: messageText,
        time: ts(),
        context: chatContext.length > 0 ? [...chatContext] : undefined,
        imageUrls: imagePreviewUrls.length > 0 ? imagePreviewUrls : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setChatContext([]);
      setIsTyping(true);

      // Find the backend session ID
      const currentSession = sessions.find((s) => s.id === targetSessionId);
      const backendId = currentSession?.backendId;

      if (backendId) {
        try {
          const reply = await sendChatMessage(userId, backendId, messageText, imageKeys.length > 0 ? imageKeys : undefined);
          setMessages((prev) => [
            ...prev,
            {
              id: `m${++_msgId}`,
              role: "assistant",
              text: reply.content,
              time: ts(),
              sources: reply.sources,
            },
          ]);
          setIsTyping(false);
          return;
        } catch (err) {
          console.error("CenterStage: failed to send message to existing session:", err);
        }
      }

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
        setIsTyping(false);
      }, 1500);
    },
    [activeTab, onTabChange, chatContext, activeSessionId, sessions, onSessionsChange, onActiveSessionIdChange, userId, stagedImages]
  );

  useEffect(() => {
    if (pendingChatMessage) {
      const title = pendingChatMessage.title ?? "Activity Discussion";
      const id = `activity_${Date.now()}`;
      setChatContext((prev) => {
        if (prev.some((c) => c.claimId === id)) return prev;
        return [...prev, { type: "activity", claimId: id, claimTitle: title, pageTitle: pendingChatMessage.text }];
      });
      onTabChange("chat");
      onPendingChatMessageHandled?.();
    }
  }, [pendingChatMessage, onTabChange, onPendingChatMessageHandled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) stageImageFile(file);
        }
      }
    },
    [stageImageFile]
  );

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
    } catch (err) {
      console.warn("CenterStage: speech recognition not supported:", err);
    }
  }, [isListening]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as ViewTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Tab triggers hidden — navigation handled by NavPanel */}
        <TabsList className="hidden">
          <TabsTrigger value="activity" />
          <TabsTrigger value="chat" />
          <TabsTrigger value="wiki" />
          <TabsTrigger value="nodemap" />
          <TabsTrigger value="sources" />
          <TabsTrigger value="figures" />
          <TabsTrigger value="glossary" />
          <TabsTrigger value="dashboard" />
          <TabsTrigger value="class-chats" />
          <TabsTrigger value="settings" />
        </TabsList>

        {/* ── Tab content ──────────────────────────────────────────────── */}

        <TabsContent value="activity" className="flex-1 overflow-y-auto">
          <ActivityFeed
              activities={activities}
              onActivitiesChange={onActivitiesChange}
              onExpandActivity={onExpandActivity}
              wikiPages={wikiPages}
              userId={userId}
            />
        </TabsContent>

        <TabsContent value="chat" className="flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            {/* Sticky chat title */}
            {(() => {
              const currentSession = sessions.find((s) => s.id === activeSessionId);
              const title = currentSession?.title;
              return title ? (
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <h2 className="truncate text-xl font-bold">{title}</h2>
                </div>
              ) : null;
            })()}
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
                  <ChatBubble key={msg.id} message={msg} onTabChange={onTabChange} userAvatar={userProfile.avatar} userId={userId} />
                ))
              )}
              {isTyping && (
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border bg-card px-4 py-3">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="wiki" className="flex-1 overflow-y-auto">
          <DemoWikiTab
            pages={wikiPages}
            onPagesChange={onWikiPagesChange}
            selectedPageId={wikiPageId}
            onSelectPage={onWikiPageSelect}
            onClaimClick={addClaimContext}
            isTeacher={isTeacher}
            userId={userId}
            onViewSource={onViewSource}
            activeTopics={new Set(activities.map((a) => a.topic))}
          />
        </TabsContent>

        <TabsContent value="nodemap" className="flex flex-1 flex-col overflow-hidden">
          <DemoNodeMapTab nodes={graphNodes} onNodeClick={handleNodeClick} />
        </TabsContent>

        <TabsContent value="sources" className="flex-1 overflow-y-auto">
          <SourceDocsManager userId={userId} userRole={userRole} pendingSourceDocId={pendingSourceDocId} onPendingSourceDocHandled={onPendingSourceDocHandled} />
        </TabsContent>

        <TabsContent value="figures" className="flex-1 overflow-y-auto">
          <FiguresPage userId={userId} userRole={userRole} />
        </TabsContent>

        <TabsContent value="glossary" className="flex-1 overflow-y-auto">
          <GlossaryTab userId={userId} userRole={userRole} onViewSource={onViewSource} />
        </TabsContent>

        {isTeacher && (
          <TabsContent value="dashboard" className="flex-1 overflow-y-auto">
            <TeacherDashboard userId={userId} onReviewActivity={onReviewActivity} />
          </TabsContent>
        )}

        {isTeacher && (
          <TabsContent value="class-chats" className="flex-1 overflow-y-auto">
            <ClassChatHistory userId={userId} />
          </TabsContent>
        )}

        <TabsContent value="settings" className="flex-1 overflow-y-auto">
          <SettingsPage
            user={userProfile}
            settings={settings}
            onUpdateProfile={onUpdateProfile}
            onUpdateSetting={onUpdateSetting}
          />
        </TabsContent>
      </Tabs>

      {/* ── Shared bottom input bar ──────────────────────────────────── */}

      <div className="border-t px-5 py-3">
        {/* Context chips */}
        {chatContext.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chatContext.map((ctx) => (
              <span
                key={ctx.claimId}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
                  ctx.type === "activity" ? "bg-amber-50 border-amber-200" : "bg-primary/5"
                }`}
              >
                {ctx.type === "activity" ? (
                  <MessageSquare className="h-3 w-3 text-amber-600" />
                ) : (
                  <Paperclip className="h-3 w-3 text-primary" />
                )}
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
        {/* Image preview strip */}
        {stagedImages.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto">
            {stagedImages.map((img) => (
              <div key={img.previewUrl} className="relative shrink-0">
                <img
                  src={img.previewUrl}
                  alt="Staged"
                  className="h-16 w-16 rounded-lg border object-cover"
                />
                {img.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                <button
                  onClick={() => removeStagedImage(img.previewUrl)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />
        <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              activeTab === "chat"
                ? "Type a message or paste an image..."
                : "Ask a question, request a hint, or search Axiom vaults..."
            }
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={() => imageInputRef.current?.click()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Attach image"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
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
            disabled={isTyping || (!input.trim() && chatContext.length === 0 && stagedImages.length === 0)}
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

function ChatBubble({ message, onTabChange, userAvatar, userId }: { message: ChatMessage; onTabChange?: (tab: ViewTab) => void; userAvatar?: string; userId: string }) {
  const [copied, setCopied] = useState(false);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (chatAudioRef.current) { chatAudioRef.current.pause(); chatAudioRef.current = null; }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("CenterStage: clipboard not available:", err);
    }
  };

  const handleReadAloud = async () => {
    if (chatAudioRef.current) { chatAudioRef.current.pause(); chatAudioRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (isSpeakingRef.current) { isSpeakingRef.current = false; return; }
    isSpeakingRef.current = true;
    try {
      const { audio_url } = await synthesizeSpeech(userId, message.text);
      if (!isSpeakingRef.current) return;
      const audio = new Audio(audio_url);
      audio.onended = () => { chatAudioRef.current = null; isSpeakingRef.current = false; };
      chatAudioRef.current = audio;
      audio.play();
    } catch {
      if (!isSpeakingRef.current) return;
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(message.text);
        window.speechSynthesis.speak(utterance);
      }
      isSpeakingRef.current = false;
    }
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

        {/* Attached images */}
        {message.imageUrls && message.imageUrls.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-2">
            {message.imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Attachment ${i + 1}`}
                className="max-h-48 max-w-xs rounded-lg border object-contain"
              />
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
        {!isUser &&
          message.sources?.tool_calls
            ?.filter((tc: any) => tc.tool === "search_glossary" && tc.data?.length > 0)
            .map((tc: any, i: number) => (
              <GlossaryInlineCard
                key={i}
                terms={tc.data}
                onNavigateToGlossary={() => onTabChange?.("glossary")}
              />
            ))}
      </div>
      {isUser && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm leading-none"
          style={{ backgroundColor: parseAvatar(userAvatar).color }}
        >
          {parseAvatar(userAvatar).icon}
        </div>
      )}
    </div>
  );
}

// ── Claim Figures (inline thumbnails for wiki claims) ────────────────────────

function ClaimFigures({ claimId, userId }: { claimId: string; userId: string }) {
  const [figures, setFigures] = useState<Figure[]>([]);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [lightboxFigure, setLightboxFigure] = useState<Figure | null>(null);

  useEffect(() => {
    listFiguresByClaim(userId, claimId)
      .then(setFigures)
      .catch(() => {});
  }, [userId, claimId]);

  useEffect(() => {
    if (figures.length === 0) return;
    Promise.all(
      figures.slice(0, 4).map(async (fig) => {
        try {
          const { url } = await getFigureViewUrl(userId, fig.id);
          return { id: fig.id, url };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const newUrls: Record<number, string> = {};
      for (const r of results) if (r) newUrls[r.id] = r.url;
      setUrls(newUrls);
    });
  }, [figures, userId]);

  if (figures.length === 0) return null;

  return (
    <>
      <div className="mt-2 flex items-center gap-2">
        <ImageIcon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground">
          {figures.length} figure{figures.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-1.5">
          {figures.slice(0, 4).map((fig) => (
            <button
              key={fig.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxFigure(fig);
              }}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded border bg-muted/30 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              {urls[fig.id] ? (
                <img
                  src={urls[fig.id]}
                  alt={fig.caption}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
              )}
            </button>
          ))}
          {figures.length > 4 && (
            <span className="flex h-10 w-10 items-center justify-center rounded border bg-muted/20 text-[10px] text-muted-foreground">
              +{figures.length - 4}
            </span>
          )}
        </div>
      </div>
      {lightboxFigure && (
        <FigureLightbox
          figure={lightboxFigure}
          figures={figures}
          userId={userId}
          onClose={() => setLightboxFigure(null)}
          onNavigate={(fig) => setLightboxFigure(fig)}
        />
      )}
    </>
  );
}

// ── Demo Wiki Tab ─────────────────────────────────────────────────────────────

interface DemoWikiTabProps {
  pages: WikiPage[];
  onPagesChange: React.Dispatch<React.SetStateAction<WikiPage[]>>;
  selectedPageId: string | null;
  onSelectPage: (id: string | null) => void;
  onClaimClick: (claim: WikiClaim, pageTitle: string) => void;
  isTeacher: boolean;
  userId: string;
  onViewSource?: (sourceDocumentId: string) => void;
  activeTopics?: Set<string>;
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
  userId,
  onViewSource,
  activeTopics,
}: DemoWikiTabProps) {
  const [mode, setMode] = useState<WikiMode>("view");
  const [editClaimId, setEditClaimId] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);

  const pollyAudioRef = useRef<HTMLAudioElement | null>(null);
  const readCancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pollyAudioRef.current) { pollyAudioRef.current.pause(); pollyAudioRef.current = null; }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      readCancelledRef.current = true;
    };
  }, []);

  const handleReadAloud = async () => {
    if (isReading) {
      readCancelledRef.current = true;
      if (pollyAudioRef.current) { pollyAudioRef.current.pause(); pollyAudioRef.current = null; }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setIsReading(false);
      return;
    }
    if (!page) return;
    const claimsText = page.claims
      .map((c, i) => `Claim ${i + 1}: ${c.title}. ${c.description}`)
      .join(". ");
    const fullText = `${page.title}. ${page.snippet}. ${claimsText}`;
    readCancelledRef.current = false;
    setIsReading(true);
    try {
      const { audio_url } = await synthesizeSpeech(userId, fullText);
      if (readCancelledRef.current) return;
      const audio = new Audio(audio_url);
      audio.playbackRate = 0.95;
      audio.onended = () => { setIsReading(false); pollyAudioRef.current = null; };
      pollyAudioRef.current = audio;
      audio.play();
    } catch {
      if (readCancelledRef.current) return;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(fullText);
        utter.rate = 0.95;
        utter.onend = () => setIsReading(false);
        window.speechSynthesis.speak(utter);
      } else {
        setIsReading(false);
      }
    }
  };

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

  const savePage = async () => {
    if (!fTitle.trim()) return;
    if (mode === "create-page") {
      const tempId = `wiki_${++_wikiCounter}`;
      const newPage: WikiPage = {
        id: tempId,
        title: fTitle.trim(),
        aliases: parseCSV(fAliases),
        snippet: fSnippet.trim(),
        updated: todayStr(),
        claims: [],
      };
      onPagesChange([...pages, newPage]);
      onSelectPage(tempId);
      try {
        const created = await createTopic(userId, fTitle.trim(), fSnippet.trim());
        onPagesChange((prev: WikiPage[]) =>
          prev.map((p) => (p.id === tempId ? { ...p, id: created.id } : p))
        );
        onSelectPage(created.id);
      } catch (err) {
        console.error("CenterStage: failed to create topic:", err);
      }
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
      try {
        await updateTopic(userId, page.id, { title: fTitle.trim(), summary: fSnippet.trim() });
      } catch (err) {
        console.error("CenterStage: failed to update topic:", err);
      }
    }
    setMode("view");
  };

  const deletePage = async (id: string) => {
    onPagesChange(pages.filter((p) => p.id !== id));
    if (selectedPageId === id) onSelectPage(null);
    try {
      await apiDeleteTopic(userId, id);
    } catch (err) {
      console.error("CenterStage: failed to delete topic:", err);
    }
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

  const saveClaim = async () => {
    if (!page || !fCTitle.trim()) return;
    const data = {
      title: fCTitle.trim(),
      description: fCDesc.trim(),
      anchors: parseCSV(fCAnchors),
    };
    if (mode === "create-claim") {
      const tempId = `claim_${++_wikiCounter}`;
      const newClaim: WikiClaim = { id: tempId, ...data };
      onPagesChange(
        pages.map((p) =>
          p.id === page.id
            ? { ...p, claims: [...p.claims, newClaim] }
            : p
        )
      );
      try {
        const created = await apiCreateClaim(userId, page.id, data.title, data.description, data.anchors[0]);
        onPagesChange((prev: WikiPage[]) =>
          prev.map((p) =>
            p.id === page.id
              ? { ...p, claims: p.claims.map((c) => (c.id === tempId ? { ...c, id: created.id } : c)) }
              : p
          )
        );
      } catch (err) {
        console.error("CenterStage: failed to create claim:", err);
      }
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
      try {
        await apiUpdateClaim(userId, editClaimId, { title: data.title, content: data.description, rubric: data.anchors[0] });
      } catch (err) {
        console.error("CenterStage: failed to update claim:", err);
      }
    }
    setMode("view");
    setEditClaimId(null);
  };

  const deleteClaim = async (claimId: string) => {
    if (!page) return;
    onPagesChange(
      pages.map((p) =>
        p.id === page.id
          ? { ...p, claims: p.claims.filter((c) => c.id !== claimId) }
          : p
      )
    );
    try {
      await apiDeleteClaim(userId, claimId);
    } catch (err) {
      console.error("CenterStage: failed to delete claim:", err);
    }
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
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{page.title}</h2>
              {activeTopics?.has(page.title) && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  Active
                </span>
              )}
              <button
                onClick={handleReadAloud}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                  isReading
                    ? "animate-pulse bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={isReading ? "Stop reading" : "Listen to this page"}
              >
                {isReading ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
            </div>
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
              {page.claims.length} axiom{page.claims.length !== 1 ? "s" : ""} &middot; Updated{" "}
              {page.updated}
            </p>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-foreground/80">
              <p>{page.snippet}</p>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">
                    Axioms
                  </h3>
                  {isTeacher && mode === "view" && (
                    <button
                      onClick={startCreateClaim}
                      className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Plus className="h-3 w-3" />
                      Add Axiom
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
                              onClick={claim.sourceDocumentId && onViewSource ? (e) => { e.stopPropagation(); onViewSource(claim.sourceDocumentId!); } : undefined}
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ${
                                claim.sourceDocumentId && onViewSource
                                  ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              <Anchor className="h-2.5 w-2.5" />
                              {anchor}
                            </span>
                          ))}
                        </div>
                        <ClaimFigures claimId={claim.id} userId={userId} />
                        <p className="mt-2 text-[10px] italic text-primary">
                          Discuss in Chat
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
                    No axioms yet.{" "}
                    {isTeacher && "Click \"Add Axiom\" to create one."}
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
          <h2 className="text-xl font-bold">Wiki</h2>
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
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{wp.title}</p>
                  {activeTopics?.has(wp.title) && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Active
                    </span>
                  )}
                </div>
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
                  {wp.claims.length} axiom{wp.claims.length !== 1 ? "s" : ""}
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
  nodes?: DemoNode[];
  onNodeClick: (nodeId: string) => void;
}

function DemoNodeMapTab({ nodes, onNodeClick }: DemoNodeMapTabProps) {
  const rawNodes = nodes ?? DEMO_NODES;
  const displayNodes = useMemo(() => simulateForces(rawNodes), [rawNodes]);
  const [hovered, setHovered] = useState<string | null>(null);

  const svgW = Math.max(850, Math.max(...displayNodes.map((n) => n.x + NODE_W)) + 40);
  const svgH = Math.max(380, Math.max(...displayNodes.map((n) => n.y + NODE_H)) + 40);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const inertiaRef = useRef<number | null>(null);
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastPointer = useRef({ x: 0, y: 0, t: 0 });

  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 3;
  const PADDING = 50;

  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return p;
    const cw = rect.width;
    const ch = rect.height;
    const scaledW = svgW * z;
    const scaledH = svgH * z;
    const minX = Math.min(PADDING, cw - scaledW - PADDING);
    const maxX = Math.max(PADDING, cw - scaledW - PADDING);
    const minY = Math.min(PADDING, ch - scaledH - PADDING);
    const maxY = Math.max(PADDING, ch - scaledH - PADDING);
    return {
      x: Math.max(Math.min(minX, maxX), Math.min(Math.max(minX, maxX), p.x)),
      y: Math.max(Math.min(minY, maxY), Math.min(Math.max(minY, maxY), p.y)),
    };
  }, [svgW, svgH]);

  const cancelInertia = useCallback(() => {
    if (inertiaRef.current != null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    cancelInertia();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let factor: number;
    if (e.ctrlKey) {
      factor = 1 - e.deltaY * 0.01;
    } else {
      factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    }

    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * factor));
      const scale = next / prev;
      setPan((p) => clampPan({ x: mx - scale * (mx - p.x), y: my - scale * (my - p.y) }, next));
      return next;
    });
  }, [clampPan, cancelInertia]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    cancelInertia();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    setPan((current) => {
      panStart.current = { ...current };
      return current;
    });
    lastPointer.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [cancelInertia]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const now = performance.now();
    const dt = now - lastPointer.current.t;
    if (dt > 0) {
      velocityRef.current = {
        x: (e.clientX - lastPointer.current.x) / dt * 16,
        y: (e.clientY - lastPointer.current.y) / dt * 16,
      };
    }
    lastPointer.current = { x: e.clientX, y: e.clientY, t: now };
    setZoom((z) => {
      setPan(() => clampPan({
        x: panStart.current.x + (e.clientX - dragStart.current.x),
        y: panStart.current.y + (e.clientY - dragStart.current.y),
      }, z));
      return z;
    });
  }, [isDragging, clampPan]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    const vx = velocityRef.current.x;
    const vy = velocityRef.current.y;
    if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) return;

    let velX = vx;
    let velY = vy;
    const decay = 0.92;

    const step = () => {
      velX *= decay;
      velY *= decay;
      if (Math.abs(velX) < 0.1 && Math.abs(velY) < 0.1) {
        inertiaRef.current = null;
        return;
      }
      setZoom((z) => {
        setPan((p) => clampPan({ x: p.x + velX, y: p.y + velY }, z));
        return z;
      });
      inertiaRef.current = requestAnimationFrame(step);
    };
    inertiaRef.current = requestAnimationFrame(step);
  }, [isDragging, clampPan]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, prev * 1.5);
      const scale = next / prev;
      setPan((p) => clampPan({ x: mx - scale * (mx - p.x), y: my - scale * (my - p.y) }, next));
      return next;
    });
  }, [clampPan]);

  const handleZoomButton = useCallback((delta: number) => {
    cancelInertia();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta));
      const scale = next / prev;
      setPan((p) => clampPan({ x: cx - scale * (cx - p.x), y: cy - scale * (cy - p.y) }, next));
      return next;
    });
  }, [clampPan, cancelInertia]);

  const handleReset = () => { cancelInertia(); setPan({ x: 0, y: 0 }); setZoom(1); };

  useEffect(() => () => cancelInertia(), [cancelInertia]);

  const getColor = (mastery: number) => {
    if (mastery === 0)
      return { fill: "#6b7280", stroke: "#4b5563", text: "#fff" };
    if (mastery === 100)
      return { fill: "#10b981", stroke: "#059669", text: "#fff" };
    return { fill: "#3b82f6", stroke: "#2563eb", text: "#fff" };
  };

  const prereqSet = new Set<string>();
  displayNodes.forEach((node) => {
    node.deps.forEach((depId) => prereqSet.add(`${depId}-${node.id}`));
  });

  return (
    <div className="flex h-full flex-col px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Knowledge Node Map</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scroll to zoom, drag to pan, double-click to zoom in. Click a node to view its wiki page.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => handleZoomButton(-0.25)} className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button onClick={() => handleZoomButton(0.25)} className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleReset} className="ml-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            Reset
          </button>
        </div>
      </div>
      <div className="mt-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-emerald-500 text-emerald-500" />
          Mastered
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-blue-500 text-blue-500" />
          In Progress
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-gray-500 text-gray-500" />
          Not Started
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-amber-500" />
          Prerequisite
        </span>
        <span className="flex items-center gap-1">
          <Circle className="h-2.5 w-2.5 fill-green-500 text-green-500" />
          Easy
        </span>
        <span className="flex items-center gap-1">
          <Circle className="h-2.5 w-2.5 fill-yellow-500 text-yellow-500" />
          Med
        </span>
        <span className="flex items-center gap-1">
          <Circle className="h-2.5 w-2.5 fill-red-500 text-red-500" />
          Hard
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-300" />
          Related
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden rounded-xl border bg-card"
        style={{ minHeight: 400, cursor: isDragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            transition: isDragging ? "none" : "transform 150ms ease-out",
          }}
        >
          <defs>
            <marker id="arrow-prereq" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
            </marker>
            <marker id="arrow-default" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#cbd5e1" />
            </marker>
          </defs>
          {displayNodes.flatMap((node) =>
            node.deps.map((depId) => {
              const dep = displayNodes.find((n) => n.id === depId);
              if (!dep) return null;
              const edgeKey = `${depId}-${node.id}`;
              const isPrereq = prereqSet.has(edgeKey);
              return (
                <line
                  key={edgeKey}
                  x1={dep.x + NODE_W / 2}
                  y1={dep.y + NODE_H / 2}
                  x2={node.x}
                  y2={node.y + NODE_H / 2}
                  stroke={isPrereq ? "#f59e0b" : "#cbd5e1"}
                  strokeWidth={isPrereq ? 2.5 : 2}
                  strokeDasharray={isPrereq ? undefined : "6 3"}
                  markerEnd={isPrereq ? "url(#arrow-prereq)" : "url(#arrow-default)"}
                />
              );
            })
          )}
          {displayNodes.map((node) => {
            const colors = getColor(node.mastery);
            const isHovered = hovered === node.id;
            return (
              <g
                key={node.id}
                data-node="true"
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onNodeClick(node.id)}
                className="cursor-pointer"
              >
                <defs>
                  <clipPath id={`pill-${node.id}`}>
                    <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={NODE_RX} />
                  </clipPath>
                </defs>
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={NODE_RX}
                  fill={colors.fill}
                  stroke={isHovered ? "#2563eb" : colors.stroke}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                />
                {node.mastery > 0 && node.mastery < 100 && (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_W * (node.mastery / 100)}
                    height={NODE_H}
                    fill={colors.fill}
                    opacity={0.3}
                    clipPath={`url(#pill-${node.id})`}
                  />
                )}
                <text
                  x={node.x + NODE_W / 2}
                  y={node.y + NODE_H / 2 + 2}
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
                    x={node.x + NODE_W - 10}
                    y={node.y + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                    fill={colors.text}
                  >
                    {node.mastery}%
                  </text>
                )}
                {node.complexity != null && (
                  <text
                    x={node.x + 10}
                    y={node.y + 12}
                    textAnchor="middle"
                    fontSize="8"
                    fontFamily="JetBrains Mono, monospace"
                    fill={node.complexity <= 2 ? "#22c55e" : node.complexity <= 3.5 ? "#eab308" : "#ef4444"}
                  >
                    {node.complexity <= 2 ? "●" : node.complexity <= 3.5 ? "●" : "●"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
