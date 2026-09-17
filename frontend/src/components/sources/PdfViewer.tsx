"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  AlertCircle,
  FileIcon,
} from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string | null;
  filename: string;
  isDemo: boolean;
}

const WINDOW_SIZE = 5;

export default function PdfViewer({ url, filename, isDemo }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pageInput, setPageInput] = useState("1");
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setLoadError(null);
  }, []);

  const onLoadError = useCallback(() => {
    setLoadError("Failed to load PDF. The URL may have expired.");
  }, []);

  const visiblePages = useMemo(() => {
    if (!numPages) return [];
    const half = Math.floor(WINDOW_SIZE / 2);
    let start = currentPage - half;
    let end = currentPage + half;
    if (start < 1) { start = 1; end = Math.min(WINDOW_SIZE, numPages); }
    if (end > numPages) { end = numPages; start = Math.max(1, numPages - WINDOW_SIZE + 1); }
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [currentPage, numPages]);

  useEffect(() => {
    const el = pageRefs.current.get(currentPage);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentPage]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages ?? 1));
      setCurrentPage(clamped);
      setPageInput(String(clamped));
    },
    [numPages]
  );

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const parsed = parseInt(pageInput, 10);
        if (!isNaN(parsed)) goToPage(parsed);
      }
    },
    [pageInput, goToPage]
  );

  const handlePageInputBlur = useCallback(() => {
    const parsed = parseInt(pageInput, 10);
    if (!isNaN(parsed)) goToPage(parsed);
    else setPageInput(String(currentPage));
  }, [pageInput, currentPage, goToPage]);

  const zoomIn = useCallback(() => setScale((s) => Math.min(s + 0.25, 3.0)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(s - 0.25, 0.5)), []);

  if (isDemo && !url) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">PDF Document</span>
        </div>
        <div className="flex flex-col items-center justify-center space-y-6 py-16">
          <div className="relative">
            <div className="w-[340px] rounded-lg border-2 border-border bg-white shadow-sm">
              <div className="border-b bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <FileIcon className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">{filename}</span>
                </div>
              </div>
              <div className="space-y-3 p-5">
                <div className="h-3 w-full rounded bg-muted/60" />
                <div className="h-3 w-[90%] rounded bg-muted/60" />
                <div className="h-3 w-[95%] rounded bg-muted/60" />
                <div className="mt-4 h-3 w-[70%] rounded bg-muted/40" />
                <div className="h-3 w-full rounded bg-muted/60" />
                <div className="h-3 w-[85%] rounded bg-muted/60" />
                <div className="mt-4 h-3 w-[60%] rounded bg-muted/40" />
                <div className="h-3 w-full rounded bg-muted/60" />
                <div className="h-3 w-[75%] rounded bg-muted/60" />
                <div className="h-3 w-[88%] rounded bg-muted/60" />
              </div>
              <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
                Page 1 of 24
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            PDF rendered via presigned S3 URL in production
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">PDF Document</span>
        {numPages && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={handlePageInputKeyDown}
              onBlur={handlePageInputBlur}
              className="h-7 w-10 rounded-md border bg-background text-center font-mono text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <span className="font-mono text-xs text-muted-foreground">/ {numPages}</span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= numPages}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <div className="mx-1.5 h-5 w-px bg-border" />

            <button
              onClick={zoomOut}
              disabled={scale <= 0.5}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-10 text-center font-mono text-xs text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={scale >= 3.0}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* PDF content */}
      <div ref={scrollRef} className="max-h-[700px] overflow-auto bg-muted/30 p-4">
        {loadError ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="mt-3 text-sm text-red-600">{loadError}</p>
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={onLoadSuccess}
            onLoadError={onLoadError}
            loading={
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">Loading PDF...</p>
              </div>
            }
          >
            <div className="flex flex-col items-center gap-4">
              {visiblePages.map((pageNum) => (
                <div
                  key={pageNum}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageNum, el);
                    else pageRefs.current.delete(pageNum);
                  }}
                >
                  <Page
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    loading={
                      <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    }
                  />
                  <p className="mt-1 text-center font-mono text-[10px] text-muted-foreground">
                    Page {pageNum}
                  </p>
                </div>
              ))}
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}
