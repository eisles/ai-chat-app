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
      source: "vectorize_api",
      reusedFrom: null,
      downloadDurationMs: 3,
      apiDurationMs: 7,
      retryWaitDurationMs: 0,
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
        debugTimings: true,
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

  it("limits heavy jobs to two claimed items even if the requested limit is larger", async () => {
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
    expect(claimPendingItemsV2).toHaveBeenCalledWith("job-1", 2);
  });

  it("allows overriding heavy product concurrency from the request payload", async () => {
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
        heavyItemConcurrency: 3,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(claimPendingItemsV2).toHaveBeenCalledWith("job-1", 3);
  });

  it("caps total vectorize in-flight across two heavy products using the request override", async () => {
    const pendingItems = [
      {
        id: "item-a",
        row_index: 4,
        city_code: "01101",
        product_id: "p-a",
        product_json: createProductJson(3),
        attempt_count: 1,
      },
      {
        id: "item-b",
        row_index: 5,
        city_code: "01101",
        product_id: "p-b",
        product_json: createProductJson(3),
        attempt_count: 1,
      },
    ];

    let active = 0;
    let maxActive = 0;
    embedOrReuseImageEmbedding.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return {
        vector: [0.1, 0.2],
        byteSize: 8,
        durationMs: 10,
        model: "vectorize-test",
        dim: 2,
        normalized: true,
        source: "vectorize_api",
        reusedFrom: null,
        downloadDurationMs: 3,
        apiDurationMs: 7,
      };
    });

    getImportJobV2
      .mockResolvedValueOnce(createVectorJob())
      .mockResolvedValueOnce({ ...createVectorJob({ status: "running" }), processedCount: 2 });
    claimPendingItemsV2
      .mockResolvedValueOnce(pendingItems)
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        limit: 5,
        timeBudgetMs: 25_000,
        vectorizeConcurrency: 5,
        maxTotalVectorizeInFlight: 3,
        maxVectorizeHeadImages: 4,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(3);
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
    expect(json.http429Count).toBe(1);
    expect(json.effectiveVectorizeConcurrency).toBe(1);
  });

  it("does not auto-lower vectorize concurrency when auto adjustment is disabled", async () => {
    const pendingItem = {
      id: "item-429-no-auto",
      row_index: 5,
      city_code: "01101",
      product_id: "p-429-no-auto",
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
        vectorizeConcurrency: 2,
        autoAdjustVectorizeConcurrency: false,
        debugTimings: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.http429Count).toBe(1);
    expect(json.effectiveVectorizeConcurrency).toBe(2);
    expect(json.itemReports?.[0]?.steps.map((step: { step: string }) => step.step)).not.toContain(
      "vectorize_concurrency_downgraded"
    );
  });

  it("keeps retrying vectorize 429 failures even after the normal retry cap", async () => {
    const pendingItem = {
      id: "item-429-max",
      row_index: 6,
      city_code: "01101",
      product_id: "p-429-max",
      product_json: createProductJson(1),
      attempt_count: 5,
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
        debugTimings: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(markItemRetryV2).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "item-429-max",
        jobId: "job-1",
        errorCode: "http_429",
        retryAfterSeconds: 180,
      })
    );
    expect(markItemFailureV2).not.toHaveBeenCalled();
    expect(json.retried).toBe(1);
    expect(json.itemReports?.[0]?.steps.map((step: { step: string }) => step.step)).toContain(
      "retry_extended_after_throttle_cap"
    );
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
        vectorizeStartIntervalMs: 0,
        debugTimings: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(claimPendingItemsV2).toHaveBeenCalledWith("job-1", 1);
    expect(
      Array.from(
        new Set(embedOrReuseImageEmbedding.mock.calls.map((call) => call[0]))
      ).sort()
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
    const stepNames = json.itemReports?.[0]?.steps.map((step: { step: string }) => step.step);
    expect(stepNames).toContain("vectorize_main_queue_wait");
    expect(stepNames).toContain("vectorize_main_download");
    expect(stepNames).toContain("vectorize_main_api");
    expect(stepNames).toContain("vectorize_main_upsert");
    expect(stepNames).toContain("enqueue_vectorize_tail_empty");
  });

  it("records stored image reuse steps in debug timings", async () => {
    const pendingItem = {
      id: "item-reused",
      row_index: 7,
      city_code: "01101",
      product_id: "p-reused",
      product_json: createProductJson(0),
      attempt_count: 1,
    };

    embedOrReuseImageEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      byteSize: 8,
      durationMs: 10,
      model: "cached-vector",
      dim: 2,
      normalized: true,
      source: "stored_image_url",
      reusedFrom: {
        productId: "cached-product",
        slideIndex: 0,
      },
    });
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
        debugTimings: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.itemReports?.[0]?.steps.map((step: { step: string }) => step.step)).toContain(
      "vectorize_main_reused"
    );
    expect(json.itemReports?.[0]?.steps.map((step: { step: string }) => step.step)).toContain(
      "vectorize_main_upsert"
    );
  });
});
