import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextEmbedding = vi.fn();

vi.mock("@/lib/image-text-search", () => ({
  generateTextEmbedding,
}));

const { clearQueryEmbeddingCache, getCachedQueryEmbedding } = await import(
  "@/lib/recommend/query-embedding-cache"
);

describe("query embedding cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryEmbeddingCache();
    generateTextEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      model: "text-embedding-test",
      dim: 2,
      normalized: null,
      durationMs: 12,
      byteSize: 8,
    });
  });

  it("同じ queryText は TTL 内で再利用する", async () => {
    const first = await getCachedQueryEmbedding("カテゴリ: 魚介");
    const second = await getCachedQueryEmbedding("カテゴリ: 魚介");

    expect(generateTextEmbedding).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      cacheHit: false,
      ttlMs: 300000,
    });
    expect(second).toMatchObject({
      cacheHit: true,
      ttlMs: 300000,
    });
    expect(first.embedding).toEqual(second.embedding);
  });

  it("clear 後は再計算する", async () => {
    await getCachedQueryEmbedding("カテゴリ: 肉");
    clearQueryEmbeddingCache();
    await getCachedQueryEmbedding("カテゴリ: 肉");

    expect(generateTextEmbedding).toHaveBeenCalledTimes(2);
  });
});
