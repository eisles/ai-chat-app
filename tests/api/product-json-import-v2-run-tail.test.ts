import { beforeEach, describe, expect, it, vi } from "vitest";

const claimPendingVectorizeTailItems = vi.fn();
const getImportJobV2 = vi.fn();
const getVectorizeTailStats = vi.fn();
const markVectorizeTailItemFailure = vi.fn();
const markVectorizeTailItemSuccess = vi.fn();
const requeueStaleVectorizeTailItems = vi.fn();
const markItemFailureV2 = vi.fn();

const embedOrReuseImageEmbedding = vi.fn();
const upsertProductImagesVectorize = vi.fn();

vi.mock("@/lib/product-json-import-v2", () => ({
  claimPendingVectorizeTailItems,
  getImportJobV2,
  getVectorizeTailStats,
  markVectorizeTailItemFailure,
  markVectorizeTailItemSuccess,
  requeueStaleVectorizeTailItems,
  markItemFailureV2,
}));

vi.mock("@/lib/vectorize-product-images", () => ({
  embedOrReuseImageEmbedding,
  upsertProductImagesVectorize,
}));

const { POST } = await import("@/app/api/product-json-import-v2/run-tail/route");

function createJob() {
  return {
    id: "job-1",
    status: "completed",
    totalCount: 1,
    processedCount: 1,
    successCount: 1,
    failureCount: 0,
    skippedCount: 0,
    existingBehavior: "skip" as const,
    doTextEmbedding: false,
    doImageCaptions: false,
    doImageVectors: true,
    captionImageInput: "url" as const,
    startedAt: "2026-03-13T09:00:00.000Z",
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:00:00.000Z",
    completedAt: "2026-03-13T09:10:00.000Z",
  };
}

describe("POST /api/product-json-import-v2/run-tail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getImportJobV2.mockResolvedValue(createJob());
    requeueStaleVectorizeTailItems.mockResolvedValue(0);
    claimPendingVectorizeTailItems.mockResolvedValue([]);
    getVectorizeTailStats.mockResolvedValue({
      pendingCount: 0,
      processingCount: 0,
      successCount: 2,
      failedCount: 0,
      nextRetryAt: null,
    });
    markVectorizeTailItemSuccess.mockResolvedValue(undefined);
    markVectorizeTailItemFailure.mockResolvedValue(undefined);
    upsertProductImagesVectorize.mockResolvedValue(undefined);
    embedOrReuseImageEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      byteSize: 8,
      durationMs: 10,
      model: "vectorize-test",
      dim: 2,
      normalized: true,
    });
  });

  it("processes only pending tail slides and marks them success", async () => {
    claimPendingVectorizeTailItems
      .mockResolvedValueOnce([
        {
          id: "tail-1",
          jobId: "job-1",
          importItemId: "item-1",
          productId: "p-1",
          cityCode: "01101",
          imageUrl: "https://example.com/slide-4.jpg",
          slideIndex: 4,
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          error: null,
          errorCode: null,
          processingStartedAt: "2026-03-13T09:00:00.000Z",
          createdAt: "2026-03-13T08:59:00.000Z",
          updatedAt: "2026-03-13T09:00:00.000Z",
        },
        {
          id: "tail-2",
          jobId: "job-1",
          importItemId: "item-1",
          productId: "p-1",
          cityCode: "01101",
          imageUrl: "https://example.com/slide-5.jpg",
          slideIndex: 5,
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          error: null,
          errorCode: null,
          processingStartedAt: "2026-03-13T09:00:00.000Z",
          createdAt: "2026-03-13T08:59:00.000Z",
          updatedAt: "2026-03-13T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/product-json-import-v2/run-tail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job-1", limit: 10 }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(embedOrReuseImageEmbedding).toHaveBeenCalledTimes(2);
    expect(upsertProductImagesVectorize).toHaveBeenCalledTimes(2);
    expect(markVectorizeTailItemSuccess).toHaveBeenCalledTimes(2);
    expect(markItemFailureV2).not.toHaveBeenCalled();
    expect(json.processed).toBe(2);
    expect(json.success).toBe(2);
    expect(json.retried).toBe(0);
    expect(json.failed).toBe(0);
  });

  it("retries retryable tail failures without rolling back import item success", async () => {
    claimPendingVectorizeTailItems
      .mockResolvedValueOnce([
        {
          id: "tail-3",
          jobId: "job-1",
          importItemId: "item-1",
          productId: "p-1",
          cityCode: "01101",
          imageUrl: "https://example.com/slide-6.jpg",
          slideIndex: 6,
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          error: null,
          errorCode: null,
          processingStartedAt: "2026-03-13T09:00:00.000Z",
          createdAt: "2026-03-13T08:59:00.000Z",
          updatedAt: "2026-03-13T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    embedOrReuseImageEmbedding.mockRejectedValue(new TypeError("network down"));

    const req = new Request("http://localhost/api/product-json-import-v2/run-tail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job-1", limit: 10 }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(markVectorizeTailItemFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tail-3",
        retryable: true,
        errorCode: "network",
      })
    );
    expect(markItemFailureV2).not.toHaveBeenCalled();
    expect(json.processed).toBe(1);
    expect(json.success).toBe(0);
    expect(json.retried).toBe(1);
    expect(json.failed).toBe(0);
  });

  it("treats vectorize 429 failures as retryable for tail backlog items", async () => {
    claimPendingVectorizeTailItems
      .mockResolvedValueOnce([
        {
          id: "tail-429",
          jobId: "job-1",
          importItemId: "item-1",
          productId: "p-1",
          cityCode: "01101",
          imageUrl: "https://example.com/slide-9.jpg",
          slideIndex: 9,
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          error: null,
          errorCode: null,
          processingStartedAt: "2026-03-13T09:00:00.000Z",
          createdAt: "2026-03-13T08:59:00.000Z",
          updatedAt: "2026-03-13T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    embedOrReuseImageEmbedding.mockRejectedValue(new Error("Vectorize API failed: 429 throttled"));

    const req = new Request("http://localhost/api/product-json-import-v2/run-tail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job-1", limit: 10 }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(markVectorizeTailItemFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tail-429",
        retryable: true,
        errorCode: "http_429",
      })
    );
    expect(markItemFailureV2).not.toHaveBeenCalled();
    expect(json.retried).toBe(1);
    expect(json.failed).toBe(0);
    expect(json.http429Count).toBe(1);
  });

  it("loops over multiple tail batches within one request", async () => {
    claimPendingVectorizeTailItems
      .mockResolvedValueOnce([
        {
          id: "tail-4",
          jobId: "job-1",
          importItemId: "item-1",
          productId: "p-1",
          cityCode: "01101",
          imageUrl: "https://example.com/slide-7.jpg",
          slideIndex: 7,
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          error: null,
          errorCode: null,
          processingStartedAt: "2026-03-13T09:00:00.000Z",
          createdAt: "2026-03-13T08:59:00.000Z",
          updatedAt: "2026-03-13T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "tail-5",
          jobId: "job-1",
          importItemId: "item-1",
          productId: "p-1",
          cityCode: "01101",
          imageUrl: "https://example.com/slide-8.jpg",
          slideIndex: 8,
          status: "processing",
          attemptCount: 1,
          nextRetryAt: null,
          error: null,
          errorCode: null,
          processingStartedAt: "2026-03-13T09:00:00.000Z",
          createdAt: "2026-03-13T08:59:00.000Z",
          updatedAt: "2026-03-13T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/product-json-import-v2/run-tail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job-1", limit: 1, timeBudgetMs: 25_000 }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(claimPendingVectorizeTailItems).toHaveBeenCalledTimes(3);
    expect(json.processed).toBe(2);
    expect(json.success).toBe(2);
  });
});
