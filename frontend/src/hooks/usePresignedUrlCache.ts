import { useCallback } from "react";
import type { ViewUrlResponse } from "@/lib/api";

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry extends ViewUrlResponse {
  expiresAt: number;
}

const urlCache = new Map<string, CacheEntry>();

export function usePresignedUrlCache() {
  const get = useCallback((docId: string): ViewUrlResponse | null => {
    const entry = urlCache.get(docId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      urlCache.delete(docId);
      return null;
    }
    return { url: entry.url, content_type: entry.content_type, filename: entry.filename };
  }, []);

  const set = useCallback((docId: string, data: ViewUrlResponse) => {
    urlCache.set(docId, { ...data, expiresAt: Date.now() + CACHE_TTL_MS });
  }, []);

  const evict = useCallback((docId: string) => {
    urlCache.delete(docId);
  }, []);

  return { get, set, evict };
}
