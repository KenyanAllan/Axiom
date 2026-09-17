"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookA,
  ChevronLeft,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GlossaryTermResponse, UserRole } from "@/lib/types";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  fetchGlossaryTerms,
  searchGlossary,
  updateGlossaryTerm,
} from "@/lib/api";

interface GlossaryTabProps {
  userId: string;
  userRole: UserRole;
}

type GlossaryMode = "list" | "detail" | "create" | "edit";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

// ── Demo fallback data ───────────────────────────────────────────────────────

const DEMO_GLOSSARY: GlossaryTermResponse[] = [
  {
    id: 1,
    workspace_id: 1,
    source_document_id: 1,
    term: "Augmented Matrix",
    definition:
      "A matrix formed by appending the columns of two matrices, typically the coefficient matrix and the constants vector of a linear system. Written as [A | b], it allows row reduction to solve the system without rewriting equations.",
    source_ref: { chunk_index: 0, text_excerpt: "An augmented matrix is formed by appending the constant vector b to the coefficient matrix A..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:35:00Z",
  },
  {
    id: 2,
    workspace_id: 1,
    source_document_id: 1,
    term: "Back Substitution",
    definition:
      "A method for solving a triangular system of equations by starting from the last equation and substituting known values upward. Used after Gaussian elimination produces row echelon form.",
    source_ref: { chunk_index: 1, text_excerpt: "Once the system is in row echelon form, back substitution proceeds from the bottom row upward..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:36:00Z",
  },
  {
    id: 3,
    workspace_id: 1,
    source_document_id: null,
    term: "Big-O Notation",
    definition:
      "A mathematical notation that describes the upper bound of an algorithm's time or space complexity as the input size grows. For example, O(n log n) means the running time grows at most proportionally to n log n.",
    source_ref: null,
    is_auto_extracted: false,
    created_at: "2026-09-15T14:25:00Z",
  },
  {
    id: 4,
    workspace_id: 1,
    source_document_id: 2,
    term: "Binary Search Tree",
    definition:
      "A binary tree data structure where each node's left subtree contains only values less than the node, and the right subtree contains only values greater. Supports O(log n) average-case search, insert, and delete.",
    source_ref: { chunk_index: 3, text_excerpt: "A binary search tree (BST) maintains the invariant that for every node, all keys in the left subtree are smaller..." },
    is_auto_extracted: true,
    created_at: "2026-09-15T14:30:00Z",
  },
  {
    id: 5,
    workspace_id: 1,
    source_document_id: 1,
    term: "Determinant",
    definition:
      "A scalar value computed from a square matrix that encodes several properties: the matrix is invertible if and only if its determinant is nonzero. Geometrically, it represents the signed volume scaling factor of the linear transformation.",
    source_ref: { chunk_index: 5, text_excerpt: "The determinant of a 2×2 matrix [[a,b],[c,d]] is ad − bc. For larger matrices, it can be computed via cofactor expansion..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:40:00Z",
  },
  {
    id: 6,
    workspace_id: 1,
    source_document_id: 1,
    term: "Eigenvalue",
    definition:
      "A scalar λ such that for a square matrix A there exists a nonzero vector v satisfying Av = λv. Eigenvalues reveal how a linear transformation stretches or compresses space along certain directions.",
    source_ref: { chunk_index: 8, text_excerpt: "An eigenvalue of a matrix A is a scalar λ for which the equation Av = λv has a nontrivial solution..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:42:00Z",
  },
  {
    id: 7,
    workspace_id: 1,
    source_document_id: 1,
    term: "Eigenvector",
    definition:
      "A nonzero vector v that, when a linear transformation A is applied, only changes by a scalar factor: Av = λv. Eigenvectors define the principal axes of the transformation.",
    source_ref: { chunk_index: 8, text_excerpt: "The corresponding eigenvectors are the nonzero solutions to (A − λI)v = 0..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:43:00Z",
  },
  {
    id: 8,
    workspace_id: 1,
    source_document_id: 1,
    term: "Gaussian Elimination",
    definition:
      "An algorithm for solving systems of linear equations by performing elementary row operations to reduce the coefficient matrix to row echelon form, after which back substitution yields the solution.",
    source_ref: { chunk_index: 1, text_excerpt: "Gaussian elimination is the fundamental algorithm for solving linear systems. It proceeds by eliminating variables column by column..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:35:30Z",
  },
  {
    id: 9,
    workspace_id: 1,
    source_document_id: 2,
    term: "Hash Table",
    definition:
      "A data structure that maps keys to values using a hash function to compute an index into an array of buckets. Provides O(1) average-case lookup, insertion, and deletion.",
    source_ref: { chunk_index: 6, text_excerpt: "A hash table uses a hash function h(k) to map each key k to a bucket index. Collisions are resolved via chaining or open addressing..." },
    is_auto_extracted: true,
    created_at: "2026-09-15T14:32:00Z",
  },
  {
    id: 10,
    workspace_id: 1,
    source_document_id: 1,
    term: "Inverse Matrix",
    definition:
      "For a square matrix A, the inverse A⁻¹ is the unique matrix such that AA⁻¹ = A⁻¹A = I (the identity matrix). A matrix has an inverse if and only if its determinant is nonzero.",
    source_ref: { chunk_index: 4, text_excerpt: "A matrix A is invertible (nonsingular) if there exists a matrix A⁻¹ satisfying AA⁻¹ = I..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:38:00Z",
  },
  {
    id: 11,
    workspace_id: 1,
    source_document_id: 2,
    term: "Linked List",
    definition:
      "A linear data structure where each element (node) contains a value and a pointer to the next node. Unlike arrays, linked lists allow O(1) insertion and deletion at any position given a reference, but require O(n) access by index.",
    source_ref: { chunk_index: 1, text_excerpt: "A linked list stores elements in nodes connected by pointers. Each node holds a data field and a reference to the next node..." },
    is_auto_extracted: true,
    created_at: "2026-09-15T14:28:00Z",
  },
  {
    id: 12,
    workspace_id: 1,
    source_document_id: 1,
    term: "Linear Independence",
    definition:
      "A set of vectors is linearly independent if no vector in the set can be written as a linear combination of the others. Equivalently, the only solution to c₁v₁ + c₂v₂ + ... + cₙvₙ = 0 is all cᵢ = 0.",
    source_ref: { chunk_index: 3, text_excerpt: "Vectors v₁, v₂, ..., vₙ are linearly independent if the equation c₁v₁ + c₂v₂ + ... + cₙvₙ = 0 implies all coefficients are zero..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:37:00Z",
  },
  {
    id: 13,
    workspace_id: 1,
    source_document_id: 1,
    term: "Partial Pivoting",
    definition:
      "A strategy in Gaussian elimination where the pivot element is chosen as the largest absolute value in the current column below the diagonal. This minimizes floating-point error amplification by keeping row multipliers ≤ 1.",
    source_ref: { chunk_index: 2, text_excerpt: "Partial pivoting selects the entry with the largest absolute value in the current column as the pivot. This prevents division by near-zero values..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:36:30Z",
  },
  {
    id: 14,
    workspace_id: 1,
    source_document_id: 1,
    term: "Rank",
    definition:
      "The rank of a matrix is the dimension of its column space (or equivalently, its row space). It equals the number of pivots in the row echelon form and indicates how many independent equations or constraints the matrix represents.",
    source_ref: { chunk_index: 4, text_excerpt: "The rank of a matrix equals the number of nonzero rows in any row echelon form. It determines the dimension of the solution space..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:39:00Z",
  },
  {
    id: 15,
    workspace_id: 1,
    source_document_id: 1,
    term: "Row Echelon Form",
    definition:
      "A matrix form where: (1) all zero rows are at the bottom, (2) the leading entry (pivot) of each nonzero row is to the right of the pivot above it, and (3) all entries below a pivot are zero. Not unique for a given matrix.",
    source_ref: { chunk_index: 1, text_excerpt: "A matrix is in row echelon form (REF) when all nonzero rows are above zero rows and each leading entry is strictly to the right of the one above..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:35:15Z",
  },
  {
    id: 16,
    workspace_id: 1,
    source_document_id: 2,
    term: "Stack",
    definition:
      "A last-in, first-out (LIFO) data structure supporting two primary operations: push (add to top) and pop (remove from top). Used in function call management, expression parsing, and undo mechanisms.",
    source_ref: { chunk_index: 2, text_excerpt: "A stack is an abstract data type following the LIFO principle. The push operation adds an element to the top; pop removes it..." },
    is_auto_extracted: true,
    created_at: "2026-09-15T14:29:00Z",
  },
  {
    id: 17,
    workspace_id: 1,
    source_document_id: 1,
    term: "Span",
    definition:
      "The span of a set of vectors is the set of all possible linear combinations of those vectors. If vectors v₁, ..., vₙ span Rⁿ, then any vector in Rⁿ can be expressed as a linear combination of them.",
    source_ref: { chunk_index: 3, text_excerpt: "The span of vectors {v₁, v₂, ..., vₖ} is the collection of all vectors that can be formed as c₁v₁ + c₂v₂ + ... + cₖvₖ..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:37:30Z",
  },
  {
    id: 18,
    workspace_id: 1,
    source_document_id: 1,
    term: "Transpose",
    definition:
      "The transpose of a matrix A, written Aᵀ, is formed by swapping its rows and columns: the (i,j) entry of Aᵀ equals the (j,i) entry of A. A matrix equal to its own transpose is called symmetric.",
    source_ref: { chunk_index: 6, text_excerpt: "The transpose of an m×n matrix A is the n×m matrix Aᵀ obtained by reflecting A across its main diagonal..." },
    is_auto_extracted: true,
    created_at: "2026-09-14T10:41:00Z",
  },
];

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function GlossaryTab({ userId, userRole }: GlossaryTabProps) {
  const [terms, setTerms] = useState<GlossaryTermResponse[]>(DEMO_GLOSSARY);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<GlossaryMode>("list");
  const [selectedTerm, setSelectedTerm] = useState<GlossaryTermResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formTerm, setFormTerm] = useState("");
  const [formDefinition, setFormDefinition] = useState("");
  const [saving, setSaving] = useState(false);

  const isTeacher = userRole === "teacher" || userRole === "individual_learner";

  const loadTerms = useCallback(async () => {
    try {
      const data = await fetchGlossaryTerms(userId);
      if (data.length > 0) setTerms(data);
    } catch {
      // API not available — keep demo fallback
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadTerms();
  }, [loadTerms]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      setLetterFilter(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!query.trim()) {
        loadTerms().then(() => {
          if (terms.length === 0) setTerms(DEMO_GLOSSARY);
        });
        return;
      }

      debounceRef.current = setTimeout(async () => {
        try {
          const res = await searchGlossary(userId, query);
          if (res.results.length > 0) {
            setTerms(res.results);
          } else {
            // Fall back to client-side filter on demo data
            const q = query.toLowerCase();
            setTerms(
              DEMO_GLOSSARY.filter(
                (t) =>
                  t.term.toLowerCase().includes(q) ||
                  t.definition.toLowerCase().includes(q)
              )
            );
          }
        } catch {
          // API unavailable — filter demo data locally
          const q = query.toLowerCase();
          setTerms(
            DEMO_GLOSSARY.filter(
              (t) =>
                t.term.toLowerCase().includes(q) ||
                t.definition.toLowerCase().includes(q)
            )
          );
        }
      }, 300);
    },
    [userId, loadTerms]
  );

  const filteredTerms = useMemo(() => {
    if (!letterFilter) return terms;
    if (letterFilter === "#") {
      return terms.filter((t) => !/^[a-zA-Z]/.test(t.term));
    }
    return terms.filter(
      (t) => t.term[0]?.toUpperCase() === letterFilter
    );
  }, [terms, letterFilter]);

  const handleCreate = async () => {
    if (!formTerm.trim() || !formDefinition.trim()) return;
    setSaving(true);
    try {
      const created = await createGlossaryTerm(userId, formTerm, formDefinition);
      setTerms((prev) => [...prev, created].sort((a, b) => a.term.localeCompare(b.term)));
      setMode("list");
      setFormTerm("");
      setFormDefinition("");
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedTerm || !formTerm.trim() || !formDefinition.trim()) return;
    setSaving(true);
    try {
      const updated = await updateGlossaryTerm(userId, selectedTerm.id, {
        term: formTerm,
        definition: formDefinition,
      });
      setTerms((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
      setSelectedTerm(updated);
      setMode("detail");
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (termId: number) => {
    try {
      await deleteGlossaryTerm(userId, termId);
      setTerms((prev) => prev.filter((t) => t.id !== termId));
      if (selectedTerm?.id === termId) {
        setSelectedTerm(null);
        setMode("list");
      }
    } catch {
      // handle error
    }
  };

  const openDetail = (term: GlossaryTermResponse) => {
    setSelectedTerm(term);
    setMode("detail");
  };

  const openEdit = (term: GlossaryTermResponse) => {
    setSelectedTerm(term);
    setFormTerm(term.term);
    setFormDefinition(term.definition);
    setMode("edit");
  };

  const openCreate = () => {
    setFormTerm("");
    setFormDefinition("");
    setMode("create");
  };

  // ── Detail view ──────────────────────────────────────────────────────────

  if (mode === "detail" && selectedTerm) {
    return (
      <div className="px-6 py-5">
        <button
          onClick={() => { setSelectedTerm(null); setMode("list"); }}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Glossary
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookA className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{selectedTerm.term}</h2>
              <span
                className={cn(
                  "mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px]",
                  selectedTerm.is_auto_extracted
                    ? "bg-secondary text-muted-foreground"
                    : "bg-primary/10 text-primary"
                )}
              >
                {selectedTerm.is_auto_extracted ? "Auto-extracted" : "Manually added"}
              </span>
            </div>
          </div>

          {isTeacher && (
            <div className="flex gap-1.5">
              <button
                onClick={() => openEdit(selectedTerm)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleDelete(selectedTerm.id)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-lg border bg-card px-5 py-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Definition</h3>
          <p className="text-sm leading-relaxed">{selectedTerm.definition}</p>
        </div>

        {selectedTerm.source_ref && (
          <div className="mt-4 rounded-lg border bg-card px-5 py-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Source Reference
            </h3>
            {selectedTerm.source_ref.chunk_index != null && (
              <p className="text-xs text-muted-foreground mb-1">
                Chunk #{selectedTerm.source_ref.chunk_index}
              </p>
            )}
            {selectedTerm.source_ref.text_excerpt && (
              <p className="text-xs text-foreground/70 italic leading-relaxed">
                &ldquo;{selectedTerm.source_ref.text_excerpt}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Create / Edit form ───────────────────────────────────────────────────

  if (mode === "create" || mode === "edit") {
    const isEdit = mode === "edit";
    return (
      <div className="px-6 py-5">
        <button
          onClick={() => { setMode(isEdit && selectedTerm ? "detail" : "list"); }}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {isEdit ? "Back to Term" : "Back to Glossary"}
        </button>

        <h2 className="text-lg font-semibold mb-4">
          {isEdit ? "Edit Term" : "New Glossary Term"}
        </h2>

        <div className="space-y-4 max-w-lg">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Term</label>
            <input
              className={inputCls}
              placeholder="e.g. Binary Search"
              value={formTerm}
              onChange={(e) => setFormTerm(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Definition</label>
            <textarea
              className={cn(inputCls, "min-h-[120px] resize-y")}
              placeholder="A clear, concise definition..."
              value={formDefinition}
              onChange={(e) => setFormDefinition(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={isEdit ? handleUpdate : handleCreate}
              disabled={saving || !formTerm.trim() || !formDefinition.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
            <button
              onClick={() => setMode(isEdit && selectedTerm ? "detail" : "list")}
              className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Glossary</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {terms.length} term{terms.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isTeacher && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Term
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className={cn(inputCls, "pl-9")}
          placeholder="Search terms..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
        {searchQuery && (
          <button
            onClick={() => handleSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Alphabet strip */}
      <div className="mb-4 flex flex-wrap gap-0.5">
        {ALPHABET.map((letter) => (
          <button
            key={letter}
            onClick={() => setLetterFilter(letterFilter === letter ? null : letter)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors",
              letterFilter === letter
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {letter}
          </button>
        ))}
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">Loading glossary...</p>
        </div>
      ) : filteredTerms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BookA className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No terms found</p>
          <p className="mt-1 text-xs">
            {searchQuery
              ? "Try a different search query"
              : "Upload a textbook or add terms manually"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTerms.map((term) => (
            <div
              key={term.id}
              onClick={() => openDetail(term)}
              className="group cursor-pointer rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold truncate pr-2">{term.term}</p>
                {isTeacher && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(term); }}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(term.id); }}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-foreground/70 line-clamp-3">
                {term.definition}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    term.is_auto_extracted
                      ? "bg-secondary text-muted-foreground"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  {term.is_auto_extracted ? "Auto" : "Manual"}
                </span>
                {term.source_ref?.chunk_index != null && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <FileText className="h-2.5 w-2.5" />
                    Chunk #{term.source_ref.chunk_index}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
