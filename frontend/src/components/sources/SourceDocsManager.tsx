"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileUp,
  X,
  ArrowLeft,
  Eye,
  Headphones,
  FileIcon,
  Video,
} from "lucide-react";
import type { SourceDocument, UserRole } from "@/lib/types";
import {
  listSourceDocs,
  uploadSourceDoc,
  deleteSourceDoc,
  getSourceViewUrl,
} from "@/lib/api";
import dynamic from "next/dynamic";
import { usePresignedUrlCache } from "@/hooks/usePresignedUrlCache";

const PdfViewer = dynamic(() => import("@/components/sources/PdfViewer"), {
  ssr: false,
});

// ── Demo fallback data ───────────────────────────────────────────────────────

const INITIAL_DOCS: SourceDocument[] = [
  {
    id: "doc_linear_algebra",
    filename: "linear_algebra_ch1-3.md",
    size_bytes: 245_800,
    uploaded_at: "2026-09-14T10:30:00Z",
    status: "ready",
    claim_count: 12,
    content_type: "text/markdown",
    transcript_s3_key: null,
  },
  {
    id: "doc_data_structures",
    filename: "data_structures_intro.md",
    size_bytes: 128_400,
    uploaded_at: "2026-09-15T14:20:00Z",
    status: "ready",
    claim_count: 8,
    content_type: "text/markdown",
    transcript_s3_key: null,
  },
  {
    id: "doc_probability",
    filename: "probability_fundamentals.txt",
    size_bytes: 98_200,
    uploaded_at: "2026-09-15T16:45:00Z",
    status: "ready",
    claim_count: 6,
    content_type: "text/plain",
    transcript_s3_key: null,
  },
  {
    id: "doc_calculus_pdf",
    filename: "calculus_theorems.pdf",
    size_bytes: 1_420_000,
    uploaded_at: "2026-09-14T08:00:00Z",
    status: "ready",
    claim_count: 15,
    content_type: "application/pdf",
    transcript_s3_key: null,
  },
  {
    id: "doc_lecture_audio",
    filename: "lecture_03_eigenvalues.mp3",
    size_bytes: 8_540_000,
    uploaded_at: "2026-09-13T11:30:00Z",
    status: "ready",
    claim_count: 9,
    content_type: "audio/mpeg",
    transcript_s3_key: "transcripts/demo_lecture_03.txt",
  },
  {
    id: "doc_discrete_math",
    filename: "discrete_math_graphs.md",
    size_bytes: 312_600,
    uploaded_at: "2026-09-16T09:15:00Z",
    status: "processing",
    claim_count: 0,
    content_type: "text/markdown",
    transcript_s3_key: null,
  },
];

const DEMO_CONTENT: Record<string, string> = {
  doc_linear_algebra: `# Linear Algebra — Chapters 1–3

## Chapter 1: Systems of Linear Equations

A **linear equation** in the variables x₁, x₂, …, xₙ is an equation of the form:

    a₁x₁ + a₂x₂ + … + aₙxₙ = b

where a₁, a₂, …, aₙ and b are real numbers. A **system of linear equations** is a collection of one or more linear equations involving the same variables.

### 1.1 Row Reduction and Echelon Forms

The basic strategy for solving a linear system is to replace one system with an equivalent system that is easier to solve. Two systems are **row equivalent** if they have the same solution set.

**Elementary Row Operations:**
1. (Replacement) Replace one row by the sum of itself and a multiple of another row
2. (Interchange) Interchange two rows
3. (Scaling) Multiply all entries in a row by a nonzero constant

A matrix is in **echelon form** if:
- All nonzero rows are above any rows of all zeros
- Each leading entry of a row is in a column to the right of the leading entry of the row above it
- All entries below a leading entry are zeros

### 1.2 Vectors and Matrices

A **matrix** is a rectangular array of numbers. An m × n matrix has m rows and n columns. The entry in the i-th row and j-th column is denoted aᵢⱼ.

The **augmented matrix** of a system is written as [A | b], where A is the coefficient matrix and b is the constants vector.

## Chapter 2: Matrix Algebra

### 2.1 Matrix Operations

If A is an m × n matrix and B is an n × p matrix, then the product AB is the m × p matrix whose (i,j)-entry is:

    (AB)ᵢⱼ = aᵢ₁b₁ⱼ + aᵢ₂b₂ⱼ + … + aᵢₙbₙⱼ

**Properties of matrix multiplication:**
- AB ≠ BA in general (not commutative)
- A(BC) = (AB)C (associative)
- A(B + C) = AB + AC (left distributive)
- (A + B)C = AC + BC (right distributive)

### 2.2 The Inverse of a Matrix

An n × n matrix A is **invertible** if there exists an n × n matrix A⁻¹ such that:

    AA⁻¹ = A⁻¹A = Iₙ

**The Invertible Matrix Theorem:** Let A be a square n × n matrix. The following are equivalent:
- A is invertible
- A has n pivot positions
- The equation Ax = 0 has only the trivial solution
- The columns of A are linearly independent
- det(A) ≠ 0

## Chapter 3: Determinants

### 3.1 Introduction to Determinants

The **determinant** is a scalar value computed from a square matrix. For a 2×2 matrix:

    det([a b; c d]) = ad − bc

For larger matrices, the determinant can be computed by **cofactor expansion** along any row or column.

### 3.2 Properties of Determinants

- det(AB) = det(A) · det(B)
- det(Aᵀ) = det(A)
- If A has a row of zeros, det(A) = 0
- If two rows of A are equal, det(A) = 0
- det(A⁻¹) = 1/det(A) when A is invertible

A matrix is invertible if and only if its determinant is nonzero. Geometrically, the absolute value of the determinant gives the scale factor by which the linear transformation changes areas (2D) or volumes (3D).
`,

  doc_data_structures: `# Introduction to Data Structures

## What Are Data Structures?

A **data structure** is a way of organizing, managing, and storing data that enables efficient access and modification. The choice of data structure can dramatically affect the performance of an algorithm.

## Arrays

An **array** is a contiguous block of memory storing elements of the same type. Each element is accessed by its index in O(1) time.

    Time Complexity:
    - Access:  O(1)
    - Search:  O(n)
    - Insert:  O(n)  (shifting required)
    - Delete:  O(n)  (shifting required)

**Dynamic arrays** (like Python's list or Java's ArrayList) automatically resize when capacity is exceeded, typically doubling in size. This gives amortized O(1) append.

## Linked Lists

A **linked list** stores elements in nodes, where each node contains a value and a pointer to the next node.

    Singly Linked List:  [data|next] → [data|next] → [data|null]

    Time Complexity:
    - Access:  O(n)
    - Search:  O(n)
    - Insert at head: O(1)
    - Delete at head: O(1)

**Doubly linked lists** also maintain a pointer to the previous node, enabling O(1) deletion when you have a reference to the node.

## Stacks and Queues

A **stack** follows Last-In-First-Out (LIFO) ordering:
- push(item): add to top — O(1)
- pop(): remove from top — O(1)
- peek(): view top item — O(1)

A **queue** follows First-In-First-Out (FIFO) ordering:
- enqueue(item): add to back — O(1)
- dequeue(): remove from front — O(1)

## Hash Tables

A **hash table** maps keys to values using a hash function. The hash function converts a key into an array index.

    Time Complexity (average case):
    - Insert:  O(1)
    - Search:  O(1)
    - Delete:  O(1)

**Collision resolution strategies:**
1. **Chaining** — each bucket holds a linked list of entries
2. **Open addressing** — probe for the next available slot (linear probing, quadratic probing, double hashing)

The **load factor** α = n/m (items/buckets). When α exceeds a threshold (typically 0.75), the table is resized and all entries are rehashed.

## Trees

A **binary tree** is a tree where each node has at most two children (left and right).

A **binary search tree (BST)** maintains the invariant: for every node, all values in its left subtree are smaller, and all values in its right subtree are larger.

    BST Time Complexity:
    - Search:  O(h), where h = height
    - Insert:  O(h)
    - Delete:  O(h)

For a balanced BST, h = O(log n). Self-balancing variants (AVL, Red-Black) guarantee this bound.

## Graphs

A **graph** G = (V, E) consists of vertices V and edges E. Graphs can be:
- **Directed** or **undirected**
- **Weighted** or **unweighted**
- **Cyclic** or **acyclic**

Common representations:
- **Adjacency matrix**: O(V²) space, O(1) edge lookup
- **Adjacency list**: O(V + E) space, O(degree) edge lookup

Fundamental graph algorithms:
- **BFS** (Breadth-First Search): explores level by level, O(V + E)
- **DFS** (Depth-First Search): explores as deep as possible first, O(V + E)
- **Dijkstra's**: shortest path from a source, O((V + E) log V) with a min-heap
`,

  doc_probability: `Probability Fundamentals — Study Notes
========================================

1. SAMPLE SPACES AND EVENTS

A sample space S is the set of all possible outcomes of a random experiment.
An event A is a subset of S. The probability P(A) satisfies:

    0 <= P(A) <= 1
    P(S) = 1
    P(empty set) = 0

If A and B are mutually exclusive (A ∩ B = empty), then:
    P(A ∪ B) = P(A) + P(B)

2. CONDITIONAL PROBABILITY

The probability of A given B has occurred:

    P(A|B) = P(A ∩ B) / P(B),  provided P(B) > 0

Two events are independent if P(A ∩ B) = P(A) · P(B), which equivalently
means P(A|B) = P(A).

3. BAYES' THEOREM

    P(A|B) = P(B|A) · P(A) / P(B)

This is central to statistical inference: given observed data B, we update
our belief about hypothesis A.

4. RANDOM VARIABLES

A random variable X maps outcomes in S to real numbers. For a discrete RV:

    E[X] = Σ x · P(X = x)          (expected value)
    Var(X) = E[(X - E[X])²]         (variance)
           = E[X²] - (E[X])²

For a continuous RV with density f(x):

    E[X] = ∫ x · f(x) dx
    Var(X) = ∫ (x - μ)² · f(x) dx

5. COMMON DISTRIBUTIONS

    Bernoulli(p):   P(X=1) = p, P(X=0) = 1-p, E[X] = p, Var(X) = p(1-p)
    Binomial(n,p):  P(X=k) = C(n,k) p^k (1-p)^(n-k), E[X] = np
    Poisson(λ):     P(X=k) = e^(-λ) λ^k / k!, E[X] = Var(X) = λ
    Normal(μ,σ²):   f(x) = (1/√(2πσ²)) exp(-(x-μ)²/(2σ²))

6. LAW OF LARGE NUMBERS

As n → ∞, the sample mean X̄ converges to the true mean μ. This justifies
using long-run frequencies as probability estimates.

7. CENTRAL LIMIT THEOREM

For i.i.d. random variables with mean μ and variance σ², the standardized
sample mean converges in distribution to N(0,1) as n → ∞:

    (X̄ - μ) / (σ/√n)  →  N(0,1)

This is why the normal distribution appears so often in practice.
`,

  doc_lecture_audio: `[Transcript — Lecture 03: Eigenvalues and Eigenvectors]

Professor: Good morning everyone. Today we're going to talk about one of the most important concepts in linear algebra — eigenvalues and eigenvectors.

So let's start with the basic question: what is an eigenvector? An eigenvector of a matrix A is a nonzero vector v such that when we multiply A times v, we get back a scalar multiple of v. That scalar is what we call the eigenvalue, usually denoted lambda.

So the equation is: A times v equals lambda times v. Or equivalently, A minus lambda I times v equals the zero vector.

Now here's the key insight — this equation has a nonzero solution v if and only if the matrix A minus lambda I is singular. And a matrix is singular if and only if its determinant is zero.

So we get what's called the characteristic equation: determinant of A minus lambda I equals zero. This is a polynomial in lambda, and its roots are the eigenvalues.

Let me do a quick example. Take the matrix A equals [2, 1; 1, 2]. The characteristic equation is:

det([2-λ, 1; 1, 2-λ]) = (2-λ)² - 1 = λ² - 4λ + 3 = (λ-1)(λ-3) = 0

So the eigenvalues are lambda equals 1 and lambda equals 3.

For lambda equals 1, we solve (A - I)v = 0, which gives us v = [1, -1] as the eigenvector.
For lambda equals 3, we solve (A - 3I)v = 0, which gives us v = [1, 1].

Notice something beautiful here — the eigenvectors are orthogonal! This is not a coincidence. It happens because A is symmetric, and symmetric matrices always have orthogonal eigenvectors. This is the Spectral Theorem.

Now why do we care about eigenvalues? Three big reasons:

First, they tell us about the behavior of dynamical systems. If you have a system x(t+1) = Ax(t), the eigenvalues determine whether solutions grow, shrink, or oscillate.

Second, they're essential for diagonalization. If A has n linearly independent eigenvectors, we can write A = PDP inverse, where D is diagonal with eigenvalues on the diagonal. This makes computing powers of A trivial — A to the k equals P D^k P inverse.

Third, eigenvalues appear everywhere in applications — Google's PageRank algorithm, principal component analysis in data science, quantum mechanics, vibration analysis in engineering. They are truly one of the most widely applied concepts in mathematics.

For next class, I want you to practice finding eigenvalues and eigenvectors for 3x3 matrices. The homework problems are on the course website. See you Thursday.

[End of transcript]
`,
};

const DEMO_DOC_IDS = new Set(Object.keys(DEMO_CONTENT));
DEMO_DOC_IDS.add("doc_calculus_pdf");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<SourceDocument["status"], React.ReactNode> = {
  uploaded: (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Loader2 className="h-3 w-3 animate-spin" />
      Uploading
    </span>
  ),
  ready: (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      Ready
    </span>
  ),
  processing: (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Loader2 className="h-3 w-3 animate-spin" />
      Processing
    </span>
  ),
  error: (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
      <AlertCircle className="h-3 w-3" />
      Error
    </span>
  ),
};

// ── Content type helpers ────────────────────────────────────────────────────

function isTextType(ct: string, filename: string): boolean {
  if (ct.startsWith("text/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["md", "mdx", "txt", "rst"].includes(ext);
}

function isPdfType(ct: string, filename: string): boolean {
  if (ct === "application/pdf") return true;
  return filename.toLowerCase().endsWith(".pdf");
}

function isAudioType(ct: string, filename: string): boolean {
  if (ct.startsWith("audio/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["mp3", "wav", "ogg", "flac", "m4a", "webm"].includes(ext);
}

function isVideoType(ct: string, filename: string): boolean {
  if (ct.startsWith("video/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["mp4", "webm"].includes(ext);
}

function getDocIcon(doc: SourceDocument) {
  if (isAudioType(doc.content_type, doc.filename)) return Headphones;
  if (isVideoType(doc.content_type, doc.filename)) return Video;
  if (isPdfType(doc.content_type, doc.filename)) return FileIcon;
  return FileText;
}

// ── Document viewer ─────────────────────────────────────────────────────────

function DocumentViewer({
  doc,
  userId,
  onBack,
}: {
  doc: SourceDocument;
  userId: string;
  onBack: () => void;
}) {
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const urlCache = usePresignedUrlCache();

  const ct = doc.content_type;
  const fname = doc.filename;
  const isText = isTextType(ct, fname);
  const isPdf = isPdfType(ct, fname);
  const isAudio = isAudioType(ct, fname);
  const isVideo = isVideoType(ct, fname);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (DEMO_DOC_IDS.has(doc.id)) {
        setIsDemo(true);
        const demo = DEMO_CONTENT[doc.id];
        if (demo && isText) {
          setTextContent(demo);
        }
        if (demo && isAudio) {
          setTranscript(demo);
        }
        setLoading(false);
        return;
      }

      try {
        const cached = urlCache.get(doc.id);
        const result = cached ?? await getSourceViewUrl(userId, doc.id);
        if (!cached) urlCache.set(doc.id, result);

        if (cancelled) return;
        setViewUrl(result.url);

        if (isText) {
          const res = await fetch(result.url);
          if (!res.ok) throw new Error(`Failed to fetch content: ${res.status}`);
          const text = await res.text();
          if (!cancelled) setTextContent(text);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load document");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [doc.id, userId, isText, isAudio]);

  const DocIcon = getDocIcon(doc);

  return (
    <div className="space-y-4 px-6 py-5">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {/* Document metadata */}
      <div className="flex items-start gap-4 rounded-lg border bg-card px-5 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <DocIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{doc.filename}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{formatBytes(doc.size_bytes)}</span>
            <span>{formatDate(doc.uploaded_at)}</span>
            {doc.claim_count > 0 && (
              <span className="font-mono">{doc.claim_count} claims extracted</span>
            )}
            {STATUS_BADGE[doc.status]}
          </div>
        </div>
      </div>

      {/* Content area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Loading document...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-red-200 bg-red-50/50 py-20">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <p className="mt-3 text-sm text-red-600">{error}</p>
        </div>
      ) : isText && textContent !== null ? (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {fname.endsWith(".md") || fname.endsWith(".mdx") ? "Markdown" : "Text"} Content
            </span>
          </div>
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-relaxed">
            {textContent}
          </pre>
        </div>
      ) : isPdf && (viewUrl || isDemo) ? (
        <PdfViewer url={viewUrl} filename={doc.filename} isDemo={isDemo} />
      ) : isAudio && (viewUrl || isDemo) ? (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-5">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Audio Player</p>
            {viewUrl ? (
              <audio controls className="w-full" src={viewUrl}>
                Your browser does not support the audio element.
              </audio>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg bg-secondary/50 p-3">
                  <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <svg className="ml-0.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                  <div className="flex-1 space-y-1.5">
                    <div className="relative h-1.5 w-full rounded-full bg-muted">
                      <div className="absolute left-0 top-0 h-full w-[35%] rounded-full bg-primary" />
                      <div className="absolute top-1/2 -translate-y-1/2 left-[35%] h-3 w-3 rounded-full bg-primary shadow" />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>12:47</span>
                      <span>36:22</span>
                    </div>
                  </div>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Audio streamed via presigned S3 URL in production
                </p>
              </div>
            )}
          </div>
          {transcript && (
            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">Transcript</span>
              </div>
              <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-relaxed">
                {transcript}
              </pre>
            </div>
          )}
        </div>
      ) : isVideo && (viewUrl || isDemo) ? (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">Video Player</span>
          </div>
          {viewUrl ? (
            <video controls className="w-full rounded-b-lg" src={viewUrl}>
              Your browser does not support the video element.
            </video>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-b-lg bg-black/90">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur">
                <svg className="ml-1 h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
          )}
        </div>
      ) : viewUrl ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20">
          <FileIcon className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Preview not available for this file type.
          </p>
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Download File
          </a>
        </div>
      ) : null}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface SourceDocsManagerProps {
  userId: string;
  userRole: UserRole;
}

export function SourceDocsManager({ userId, userRole }: SourceDocsManagerProps) {
  const canUpload = userRole !== "student";
  const canDelete = userRole !== "student";
  const [docs, setDocs] = useState<SourceDocument[]>(INITIAL_DOCS);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<SourceDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load documents from API on mount ────────────────────────────────────

  const fetchDocs = useCallback(async () => {
    try {
      const apiDocs = await listSourceDocs(userId);
      if (apiDocs.length > 0) {
        setDocs(apiDocs);
      }
    } catch {
      // API not available — keep hardcoded fallback
    }
  }, [userId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // ── Poll for status updates when any doc is still processing ────────────

  useEffect(() => {
    const hasProcessing = docs.some(
      (d) => d.status === "processing" || d.status === "uploaded"
    );

    if (hasProcessing) {
      pollRef.current = setInterval(() => {
        fetchDocs();
      }, 5000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [docs, fetchDocs]);

  // ── Upload handler ──────────────────────────────────────────────────────

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      try {
        const uploaded = await uploadSourceDoc(userId, file);
        setDocs((prev) => [uploaded, ...prev]);
      } catch {
        const fallbackDoc: SourceDocument = {
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          filename: file.name,
          size_bytes: file.size,
          uploaded_at: new Date().toISOString(),
          status: "error",
          claim_count: 0,
          content_type: file.type || "application/octet-stream",
          transcript_s3_key: null,
        };
        setDocs((prev) => [fallbackDoc, ...prev]);
      }
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Delete handler ──────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setDeleteConfirm(null);

    try {
      await deleteSourceDoc(userId, id);
    } catch {
      fetchDocs();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // ── Viewer mode ─────────────────────────────────────────────────────────

  if (selectedDoc) {
    return (
      <DocumentViewer
        doc={selectedDoc}
        userId={userId}
        onBack={() => setSelectedDoc(null)}
      />
    );
  }

  // ── List mode ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 px-6 py-5">
      {/* Upload zone — teachers & individual learners only */}
      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-accent/30"
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <FileUp className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium">
            Drop files here, or{" "}
            <button
              onClick={() => fileRef.current?.click()}
              className="text-primary hover:text-primary/80"
            >
              browse
            </button>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Supports .md, .txt, .pdf, and audio files. Max 10 MB per file.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.mdx,.txt,.pdf,.mp3,.mp4,.wav,.ogg,.flac,.webm,.m4a"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="hidden"
          />
        </div>
      )}

      {/* Document list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Source Documents
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              ({docs.length})
            </span>
          </h3>
        </div>

        {docs.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              No documents uploaded yet.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {canUpload
                ? "Upload files to extract atomic claims."
                : "Your teacher will add source documents here."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => {
              const isReady = doc.status === "ready";
              const DocIcon = getDocIcon(doc);

              return (
                <div
                  key={doc.id}
                  onClick={isReady ? () => setSelectedDoc(doc) : undefined}
                  className={`flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-colors ${
                    isReady
                      ? "cursor-pointer hover:bg-accent/50 hover:border-primary/30"
                      : "hover:bg-accent/30"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <DocIcon className="h-4 w-4 text-muted-foreground" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {doc.filename}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatBytes(doc.size_bytes)}</span>
                      <span>{formatDate(doc.uploaded_at)}</span>
                      {doc.status === "ready" && (
                        <span className="font-mono">
                          {doc.claim_count} claims
                        </span>
                      )}
                    </div>
                  </div>

                  {isReady && (
                    <Eye className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  )}

                  {STATUS_BADGE[doc.status]}

                  {canDelete && (
                    deleteConfirm === doc.id ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="rounded bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(doc.id);
                        }}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Delete document"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
