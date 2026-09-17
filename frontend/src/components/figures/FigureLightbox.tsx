"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Trash2,
  ImageIcon,
  FileText,
  Tag,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Figure } from "@/lib/types";
import { getFigureViewUrl, deleteFigure } from "@/lib/api";

interface FigureLightboxProps {
  figure: Figure;
  figures?: Figure[];
  userId: string;
  canDelete?: boolean;
  onClose: () => void;
  onDeleted?: (figureId: number) => void;
  onNavigate?: (figure: Figure) => void;
}

const TYPE_COLORS: Record<string, string> = {
  diagram: "bg-blue-100 text-blue-700",
  chart: "bg-green-100 text-green-700",
  graph: "bg-purple-100 text-purple-700",
  table: "bg-amber-100 text-amber-700",
  equation: "bg-red-100 text-red-700",
  flowchart: "bg-cyan-100 text-cyan-700",
  illustration: "bg-indigo-100 text-indigo-700",
  photo: "bg-orange-100 text-orange-700",
};

export default function FigureLightbox({
  figure,
  figures,
  userId,
  canDelete,
  onClose,
  onDeleted,
  onNavigate,
}: FigureLightboxProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentIndex = figures?.findIndex((f) => f.id === figure.id) ?? -1;
  const hasPrev = figures && currentIndex > 0;
  const hasNext = figures && currentIndex >= 0 && currentIndex < figures.length - 1;

  useEffect(() => {
    setLoading(true);
    setUrl(null);
    getFigureViewUrl(userId, figure.id)
      .then(({ url }) => setUrl(url))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, figure.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate?.(figures![currentIndex - 1]);
      if (e.key === "ArrowRight" && hasNext) onNavigate?.(figures![currentIndex + 1]);
    },
    [onClose, hasPrev, hasNext, figures, currentIndex, onNavigate]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteFigure(userId, figure.id);
      onDeleted?.(figure.id);
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-[90vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              TYPE_COLORS[figure.figure_type] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {figure.figure_type}
          </span>
          {figure.page_number != null && (
            <span className="text-xs text-muted-foreground">
              Page {figure.page_number}
            </span>
          )}
          {figures && figures.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {currentIndex + 1} / {figures.length}
            </span>
          )}
          <div className="flex-1" />
          {canDelete && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-500">Delete this figure?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Confirm"
                  )}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )
          )}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Main content area */}
        <div className="flex min-h-0 flex-1">
          {/* Image pane */}
          <div className="relative flex flex-1 items-center justify-center bg-muted/30 p-6">
            {/* Prev/Next arrows */}
            {hasPrev && (
              <button
                onClick={() => onNavigate?.(figures![currentIndex - 1])}
                className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 shadow-md transition-colors hover:bg-background"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {hasNext && (
              <button
                onClick={() => onNavigate?.(figures![currentIndex + 1])}
                className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 shadow-md transition-colors hover:bg-background"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

            {loading ? (
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground/40" />
            ) : url ? (
              <img
                src={url}
                alt={figure.caption}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
            )}
          </div>

          {/* Detail sidebar */}
          <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
            {/* Caption */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">Caption</h3>
              <p className="text-sm leading-relaxed">{figure.caption}</p>
            </div>

            {/* OCR text */}
            {figure.ocr_text && (
              <div className="mt-5 space-y-1">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Detected Text
                </h3>
                <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                  {figure.ocr_text}
                </p>
              </div>
            )}

            {/* Labels */}
            {figure.labels && figure.labels.length > 0 && (
              <div className="mt-5 space-y-1">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" />
                  Labels
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {figure.labels.map((label) => (
                    <span
                      key={label.name}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs"
                    >
                      {label.name}
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(label.confidence)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="mt-5 space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">Details</h3>
              <dl className="space-y-1.5 text-xs">
                {figure.width && figure.height && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Dimensions</dt>
                    <dd>{figure.width} x {figure.height}</dd>
                  </div>
                )}
                {figure.size_bytes && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd>
                      {figure.size_bytes < 1024
                        ? `${figure.size_bytes} B`
                        : figure.size_bytes < 1024 * 1024
                          ? `${(figure.size_bytes / 1024).toFixed(1)} KB`
                          : `${(figure.size_bytes / (1024 * 1024)).toFixed(1)} MB`}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Content Type</dt>
                  <dd>{figure.content_type}</dd>
                </div>
                {figure.associated_claim_ids.length > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Linked Claims</dt>
                    <dd>{figure.associated_claim_ids.length}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
