"use client";

import { useState, useRef } from "react";
import {
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileUp,
  X,
} from "lucide-react";
import type { SourceDocument } from "@/lib/types";

// ── Demo data ─────────────────────────────────────────────────────────────────

const INITIAL_DOCS: SourceDocument[] = [
  {
    id: "doc_linear_algebra",
    filename: "linear_algebra_ch1-3.md",
    size_bytes: 245_800,
    uploaded_at: "2026-09-14T10:30:00Z",
    status: "ready",
    claim_count: 12,
  },
  {
    id: "doc_data_structures",
    filename: "data_structures_intro.md",
    size_bytes: 128_400,
    uploaded_at: "2026-09-15T14:20:00Z",
    status: "ready",
    claim_count: 8,
  },
  {
    id: "doc_discrete_math",
    filename: "discrete_math_graphs.md",
    size_bytes: 312_600,
    uploaded_at: "2026-09-16T09:15:00Z",
    status: "processing",
    claim_count: 0,
  },
];

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

export function SourceDocsManager() {
  const [docs, setDocs] = useState<SourceDocument[]>(INITIAL_DOCS);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    // Simulate upload + processing for each file
    for (const file of Array.from(files)) {
      const newDoc: SourceDocument = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        size_bytes: file.size,
        uploaded_at: new Date().toISOString(),
        status: "processing",
        claim_count: 0,
      };
      setDocs((prev) => [newDoc, ...prev]);

      // Simulate processing completing after a delay
      setTimeout(() => {
        setDocs((prev) =>
          prev.map((d) =>
            d.id === newDoc.id
              ? { ...d, status: "ready" as const, claim_count: Math.floor(Math.random() * 15) + 3 }
              : d
          )
        );
      }, 3000 + Math.random() * 2000);
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDelete = (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setDeleteConfirm(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  return (
    <div className="space-y-6 px-6 py-5">
      {/* Upload zone */}
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
          Drop markdown files here, or{" "}
          <button
            onClick={() => fileRef.current?.click()}
            className="text-primary hover:text-primary/80"
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Supports .md, .mdx, and .txt files. Max 10 MB per file.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.mdx,.txt"
          multiple
          onChange={(e) => handleUpload(e.target.files)}
          className="hidden"
        />
      </div>

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
              Upload markdown files to extract atomic claims.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/30"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <FileText className="h-4 w-4 text-muted-foreground" />
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

                {STATUS_BADGE[doc.status]}

                {/* Delete button */}
                {deleteConfirm === doc.id ? (
                  <div className="flex items-center gap-1.5">
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
                    onClick={() => setDeleteConfirm(doc.id)}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Delete document"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
