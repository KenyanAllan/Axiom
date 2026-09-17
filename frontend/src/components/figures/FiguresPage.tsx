"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Loader2, Search, Filter } from "lucide-react";
import type { Figure } from "@/lib/types";
import type { UserRole } from "@/lib/types";
import { listFigures, getFigureViewUrl } from "@/lib/api";
import FigureLightbox from "./FigureLightbox";

interface FiguresPageProps {
  userId: string;
  userRole: UserRole;
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

const ALL_TYPES = [
  "diagram",
  "chart",
  "graph",
  "table",
  "equation",
  "flowchart",
  "illustration",
  "photo",
];

export function FiguresPage({ userId, userRole }: FiguresPageProps) {
  const [figures, setFigures] = useState<Figure[]>([]);
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [selectedFigure, setSelectedFigure] = useState<Figure | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const canDelete = userRole !== "student";

  const fetchFigures = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFigures(userId);
      setFigures(data);
    } catch {
      // API might not be running
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchFigures();
  }, [fetchFigures]);

  useEffect(() => {
    if (figures.length === 0) return;
    const toLoad = figures.filter((f) => !urls[f.id]);
    if (toLoad.length === 0) return;

    const batch = toLoad.slice(0, 20);
    Promise.all(
      batch.map(async (fig) => {
        try {
          const { url } = await getFigureViewUrl(userId, fig.id);
          return { id: fig.id, url };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const newUrls: Record<number, string> = {};
      for (const r of results) {
        if (r) newUrls[r.id] = r.url;
      }
      setUrls((prev) => ({ ...prev, ...newUrls }));
    });
  }, [figures, userId, urls]);

  const filtered = figures.filter((fig) => {
    if (typeFilter && fig.figure_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        fig.caption.toLowerCase().includes(q) ||
        fig.figure_type.toLowerCase().includes(q) ||
        (fig.ocr_text?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const typeCounts = figures.reduce<Record<string, number>>((acc, fig) => {
    acc[fig.figure_type] = (acc[fig.figure_type] ?? 0) + 1;
    return acc;
  }, {});

  const handleDeleted = (figureId: number) => {
    setFigures((prev) => prev.filter((f) => f.id !== figureId));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Loading figures...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-6 py-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold">Figures</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Images, charts, and diagrams extracted from your source documents.
        </p>
      </div>

      {figures.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20">
          <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No figures yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {userRole === "student"
              ? "Figures will appear here once your teacher uploads source documents."
              : "Upload PDFs or images in Source Docs to extract figures automatically."}
          </p>
        </div>
      ) : (
        <>
          {/* Search + filter bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search figures by caption or text..."
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {filtered.length} of {figures.length}
            </span>
          </div>

          {/* Type filter chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <button
              onClick={() => setTypeFilter(null)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                typeFilter === null
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            {ALL_TYPES.filter((t) => typeCounts[t]).map((type) => (
              <button
                key={type}
                onClick={() =>
                  setTypeFilter(typeFilter === type ? null : type)
                }
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  typeFilter === type
                    ? "bg-primary text-primary-foreground"
                    : `${TYPE_COLORS[type] ?? "bg-secondary text-muted-foreground"} hover:opacity-80`
                }`}
              >
                {type} ({typeCounts[type]})
              </button>
            ))}
          </div>

          {/* Gallery grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((fig) => (
              <button
                key={fig.id}
                type="button"
                className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:shadow-lg hover:border-primary/30"
                onClick={() => setSelectedFigure(fig)}
              >
                <div className="relative flex h-40 items-center justify-center bg-muted/40">
                  {urls[fig.id] ? (
                    <img
                      src={urls[fig.id]}
                      alt={fig.caption}
                      className="max-h-full max-w-full object-contain p-1 transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                  )}
                  {fig.page_number != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      p.{fig.page_number}
                    </span>
                  )}
                  {fig.associated_claim_ids.length > 0 && (
                    <span className="absolute top-1 right-1 rounded bg-primary/80 px-1.5 py-0.5 text-[10px] text-white">
                      {fig.associated_claim_ids.length} claim{fig.associated_claim_ids.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 p-2">
                  <span
                    className={`self-start rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      TYPE_COLORS[fig.figure_type] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {fig.figure_type}
                  </span>
                  <p className="line-clamp-2 text-left text-xs text-muted-foreground">
                    {fig.caption}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
              <Search className="h-6 w-6 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                No figures match your filters.
              </p>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {selectedFigure && (
        <FigureLightbox
          figure={selectedFigure}
          figures={filtered}
          userId={userId}
          canDelete={canDelete}
          onClose={() => setSelectedFigure(null)}
          onDeleted={handleDeleted}
          onNavigate={(fig) => setSelectedFigure(fig)}
        />
      )}
    </div>
  );
}
