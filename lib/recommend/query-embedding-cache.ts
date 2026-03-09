import { createHash } from "crypto";

import {
  generateTextEmbedding,
  type EmbeddingResult,
} from "@/lib/image-text-search";

type CacheEntry = {
  expiresAt: number;
  value: EmbeddingResult;
};

export const QUERY_EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<
  string,
  Promise<{
    embedding: EmbeddingResult;
    cacheHit: boolean;
    ttlMs: number;
  }>
>();

function hashQueryText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function pruneExpiredEntries(now: number) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function enforceCacheLimit() {
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

export async function getCachedQueryEmbedding(
  text: string
): Promise<{
  embedding: EmbeddingResult;
  cacheHit: boolean;
  ttlMs: number;
}> {
  const key = hashQueryText(text);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return {
      embedding: cached.value,
      cacheHit: true,
      ttlMs: QUERY_EMBEDDING_CACHE_TTL_MS,
    };
  }

  cache.delete(key);

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const next = (async () => {
    const value = await generateTextEmbedding(text);
    pruneExpiredEntries(Date.now());
    enforceCacheLimit();
    cache.set(key, {
      value,
      expiresAt: Date.now() + QUERY_EMBEDDING_CACHE_TTL_MS,
    });
    return {
      embedding: value,
      cacheHit: false,
      ttlMs: QUERY_EMBEDDING_CACHE_TTL_MS,
    };
  })();

  inFlight.set(key, next);

  try {
    return await next;
  } finally {
    inFlight.delete(key);
  }
}

export function clearQueryEmbeddingCache() {
  cache.clear();
  inFlight.clear();
}
