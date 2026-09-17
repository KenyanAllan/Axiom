"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import type { Figure } from "@/lib/types";
import type { UserRole } from "@/lib/types";
import { getFigureViewUrl } from "@/lib/api";
import FigureLightbox from "./FigureLightbox";

interface FigureGalleryProps {
  figures: Figure[];
  userId: string;
  userRole?: UserRole;
  onFigureDeleted?: (figureId: number) => void;
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

export default function FigureGallery({
  figures,
  userId,
  userRole,
  onFigureDeleted,
}: FigureGalleryProps) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [selectedFigure, setSelectedFigure] = useState<Figure | null>(null);

  const canDelete = userRole != null && userRole !== "student";

  const loadUrls = useCallback(async () => {
    const newUrls: Record<number, string> = {};
    await Promise.all(
      figures.map(async (fig) => {
        try {
          const { url } = await getFigureViewUrl(userId, fig.id);
          newUrls[fig.id] = url;
        } catch {
          // skip failed URLs
        }
      })
    );
    setUrls(newUrls);
  }, [figures, userId]);

  useEffect(() => {
    if (figures.length > 0) loadUrls();
  }, [figures, loadUrls]);

  if (figures.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {figures.map((fig) => (
          <button
            key={fig.id}
            type="button"
            className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md hover:border-primary/30"
            onClick={() => setSelectedFigure(fig)}
          >
            <div className="relative flex h-36 items-center justify-center bg-muted/40">
              {urls[fig.id] ? (
                <img
                  src={urls[fig.id]}
                  alt={fig.caption}
                  className="max-h-full max-w-full object-contain p-1"
                />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
              )}
              {fig.page_number != null && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  p.{fig.page_number}
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

      {selectedFigure && (
        <FigureLightbox
          figure={selectedFigure}
          figures={figures}
          userId={userId}
          canDelete={canDelete}
          onClose={() => setSelectedFigure(null)}
          onDeleted={onFigureDeleted}
          onNavigate={(fig) => setSelectedFigure(fig)}
        />
      )}
    </>
  );
}
