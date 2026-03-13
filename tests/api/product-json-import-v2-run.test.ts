import { beforeEach, describe, expect, it, vi } from "vitest";

const claimPendingItemsV2 = vi.fn();
const getImportJobV2 = vi.fn();
const markJobStartedV2 = vi.fn();
const markItemsSkippedBulkV2 = vi.fn();
const markItemFailureV2 = vi.fn();
const markItemRetryV2 = vi.fn();
const markItemSkippedV2 = vi.fn();
const markItemSuccessV2 = vi.fn();
const requeueStaleProcessingItemsV2 = vi.fn();
const releaseClaimedItemsV2 = vi.fn();
const updateJobStatusV2 = vi.fn();
const enqueueVectorizeTailItems = vi.fn();
const checkExistingVectorizationComplete = vi.fn();

const buildProductEmbeddingText = vi.fn();
const checkExistingProductTextSource = vi.fn();
const checkExistingProductTextSourcesAny = vi.fn();
const deleteProductTextEntries = vi.fn();
const getExistingProductIdsForSource = vi.fn();
const getExistingProductIdsForSources = vi.fn();
const registerTextEntry = vi.fn();

const deleteProductImagesVectorize = vi.fn();
const embedOrReuseImageEmbedding = vi.fn();
const upsertProductImagesVectorize = vi.fn();

vi.mock("@/lib/product-json-import-v2", () => ({
  claimPendingItemsV2,
  getImportJobV2,
  markJobStartedV2,
  markItemsSkippedBulkV2,
  markItemFailureV2,
  markItemRetryV2,
  markItemSkippedV2,
  markItemSuccessV2,
  requeueStaleProcessingItemsV2,
  releaseClaimedItemsV2,
  updateJobStatusV2,
  enqueueVectorizeTailItems,
  checkExistingVectorizationComplete,
}));

vi.mock("@/lib/image-text-search", () => ({
  buildProductEmbeddingText,
  checkExistingProductTextSource,
  checkExistingProductTextSourcesAny,
  deleteProductTextEntries,
  getExistingProductIdsForSource,
  getExistingProductIdsForSources,
  registerTextEntry,
}));

vi.mock("@/lib/vectorize-product-images", () => ({
  deleteProductImagesVectorize,
  embedOrReuseImageEmbedding,
  upsertProductImagesVectorize,
}));

const { POST } = await import("@/app/api/product-json-import-v2/run/route");

function createVectorJob(overrides?: Partial<{
  status: string;
  existingBehavior: "skip" | "delete_then_insert";
}>) {
  return {
    id: "job-1",
    status: overrides?.status ?? "pending",
    totalCount: 1,
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    existingBehavior: overrides?.existingBehavior ?? "delete_then_insert",
    doTextEmbedding: false,
    doImageCaptions: false,
    doImageVectors: true,
    captionImageInput: "url" as const,
    startedAt: "2026-03-13T09:00:00.000Z",
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:00:00.000Z",
    completedAt: null,
  };
}

function createProductJson(slideCount: number): string {
  const product: Record<string, string> = {
    id: "p-1",
    name: "Tail target",
    image: "https://example.com/main.jpg",
  };
  for (let index = 1; index <= slideCount; index += 1) {
    product[`slide_image${index}`] = `https://example.com/slide-${index}.jpg`;
  }
  return JSON.stringify(product);
}

describe("POST /api/product-json-import-v2/run", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    markJobStartedV2.mockResolvedValue(true);
    requeueStaleProcessingItemsV2.mockResolvedValue(0);
    updateJobStatusV2.mockResolvedValue(undefined);
    markItemSuccessV2.mockResolvedValue(undefined);
    markItemSkippedV2.mockResolvedValue(undefined);
    markItemFailureV2.mockResolvedValue(undefined);
    markItemRetryV2.mockResolvedValue(undefined);
    markItemsSkippedBulkV2.mockResolvedValue(0);
    releaseClaimedItemsV2.mockResolvedValue(undefined);
    deleteProductTextEntries.mockResolvedValue(0);
    deleteProductImagesVectorize.mockResolvedValue(0);
    embedOrReuseImageEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      byteSize: 8,
      durationMs: 10,
      model: "vectorize-test",
      dim: 2,
      normalized: true,
    });
    upsertProductImagesVectorize.mockResolvedValue(undefined);
    enqueueVectorizeTailItems.mockResolvedValue(3);
    checkExistingVectorizationComplete.mockResolvedValue(false);
    getExistingProductIdsForSource.mockResolvedValue(new Set<string>());
    getExistingProductIdsForSources.mockResolvedValue(new Set<string>());
  });

  it("vectorizes only main plus first three slides and enqueues remaining slides", async () => {
    const pendingItem = {
      id: "item-1",
      row_index: 2,
      city_code: "01101",
      product_id: "p-1",
      product_json: createProductJson(6),
      attempt_count: 1,
    };

    getImportJobV2
      .mockResolvedValueOnce(createVectorJob())
      .mockResolvedValueOnce({ ...createVectorJob({ status: "running" }), processedCount: 1 });
    claimPendingItemsV2
      .mockResolvedValueOnce([pendingItem])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        limit: 1,
        timeBudgetMs: 10_000,
        vectorizeConcurrency: 2,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(embedOrReuseImageEmbedding).toHaveBeenCalledTimes(4);
    expect(
      embedOrReuseImageEmbedding.mock.calls.map((call) => call[0]).sort()
    ).toEqual([
      "https://example.com/main.jpg",
      "https://example.com/slide-1.jpg",
      "https://example.com/slide-2.jpg",
      "https://example.com/slide-3.jpg",
    ]);
    expect(
      upsertProductImagesVectorize.mock.calls
        .map((call) => call[0].slideIndex)
        .sort((left, right) => left - right)
    ).toEqual([0, 1, 2, 3]);
    expect(enqueueVectorizeTailItems).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        importItemId: "item-1",
        productId: "p-1",
        items: [
          { imageUrl: "https://example.com/slide-4.jpg", slideIndex: 4 },
          { imageUrl: "https://example.com/slide-5.jpg", slideIndex: 5 },
          { imageUrl: "https://example.com/slide-6.jpg", slideIndex: 6 },
        ],
      })
    );
    expect(markItemSuccessV2).toHaveBeenCalledWith({ itemId: "item-1", jobId: "job-1" });
    expect(json.processed).toBe(1);
  });

  it("uses complete vectorization check instead of product-level bulk skip when vectors are enabled", async () => {
    const pendingItem = {
      id: "item-2",
      row_index: 3,
      city_code: "01101",
      product_id: "p-1",
      product_json: createProductJson(1),
      attempt_count: 1,
    };

    getImportJobV2
      .mockResolvedValueOnce(createVectorJob({ existingBehavior: "skip" }))
      .mockResolvedValueOnce({
        ...createVectorJob({ existingBehavior: "skip", status: "running" }),
        processedCount: 1,
      });
    claimPendingItemsV2
      .mockResolvedValueOnce([pendingItem])
      .mockResolvedValueOnce([]);
    checkExistingVectorizationComplete.mockResolvedValue(false);

    const req = new Request("http://localhost/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        limit: 1,
        timeBudgetMs: 10_000,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(markItemsSkippedBulkV2).not.toHaveBeenCalled();
    expect(checkExistingVectorizationComplete).toHaveBeenCalledWith({
      productId: "p-1",
      expectedSlideIndexes: [0, 1],
    });
    expect(embedOrReuseImageEmbedding).toHaveBeenCalled();
    expect(markItemSuccessV2).toHaveBeenCalledWith({ itemId: "item-2", jobId: "job-1" });
  });

  it("limits heavy jobs to one claimed item even if the requested limit is larger", async () => {
    getImportJobV2
      .mockResolvedValueOnce(createVectorJob())
      .mockResolvedValueOnce(createVectorJob({ status: "running" }));
    claimPendingItemsV2.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        limit: 5,
        timeBudgetMs: 25_000,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(claimPendingItemsV2).toHaveBeenCalledWith("job-1", 1);
  });

  it("retries vectorize 429 failures instead of marking the import item failed", async () => {
    const pendingItem = {
      id: "item-429",
      row_index: 4,
      city_code: "01101",
      product_id: "p-429",
      product_json: createProductJson(1),
      attempt_count: 1,
    };

    getImportJobV2
      .mockResolvedValueOnce(createVectorJob())
      .mockResolvedValueOnce({ ...createVectorJob({ status: "running" }), processedCount: 0 });
    claimPendingItemsV2
      .mockResolvedValueOnce([pendingItem])
      .mockResolvedValueOnce([]);
    embedOrReuseImageEmbedding.mockRejectedValue(new Error("Vectorize API failed: 429 throttled"));

    const req = new Request("http://localhost/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        limit: 1,
        timeBudgetMs: 10_000,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(markItemRetryV2).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "item-429",
        jobId: "job-1",
        errorCode: "http_429",
      })
    );
    expect(markItemFailureV2).not.toHaveBeenCalled();
    expect(json.retried).toBe(1);
  });

  it("processes all images in the initial run when maxVectorizeHeadImages covers them", async () => {
    const pendingItem = {
      id: "item-3",
      row_index: 4,
      city_code: "01101",
      product_id: "p-1",
      product_json: createProductJson(4),
      attempt_count: 1,
    };

    getImportJobV2
      .mockResolvedValueOnce(createVectorJob())
      .mockResolvedValueOnce({ ...createVectorJob({ status: "running" }), processedCount: 1 });
    claimPendingItemsV2.mockResolvedValueOnce([pendingItem]).mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        limit: 1,
        timeBudgetMs: 10_000,
        maxVectorizeHeadImages: 9,
        debugTimings: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(claimPendingItemsV2).toHaveBeenCalledWith("job-1", 1);
    expect(embedOrReuseImageEmbedding).toHaveBeenCalledTimes(5);
    expect(
      embedOrReuseImageEmbedding.mock.calls.map((call) => call[0]).sort()
    ).toEqual([
      "https://example.com/main.jpg",
      "https://example.com/slide-1.jpg",
      "https://example.com/slide-2.jpg",
      "https://example.com/slide-3.jpg",
      "https://example.com/slide-4.jpg",
    ]);
    expect(enqueueVectorizeTailItems).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [],
      })
    );
    expect(json.itemReports?.[0]?.steps.map((step: { step: string }) => step.step)).toContain(
      "enqueue_vectorize_tail_empty"
    );
  });
});
