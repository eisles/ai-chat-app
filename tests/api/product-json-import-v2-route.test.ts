import { beforeEach, describe, expect, it, vi } from "vitest";

const getFailedItemsV2 = vi.fn();
const getImportJobV2 = vi.fn();
const getProcessingItemsV2 = vi.fn();
const getQueueStatsV2 = vi.fn();
const getScopedImportSummaryV2 = vi.fn();
const getVectorizeTailStats = vi.fn();

vi.mock("@/lib/product-json-import-v2", () => ({
  appendImportItemsV2: vi.fn(),
  createImportJobBaseV2: vi.fn(),
  createImportJobV2: vi.fn(),
  CAPTION_IMAGE_INPUT_MODES: ["url", "data_url"],
  getQueueStatsV2,
  getScopedImportSummaryV2,
  getFailedItemsV2,
  getImportJobV2,
  getProcessingItemsV2,
  getVectorizeTailStats,
}));

vi.mock("@/lib/product-import-behavior", () => ({
  parseExistingProductBehavior: (value: unknown) => value,
}));

const { GET } = await import("@/app/api/product-json-import-v2/route");

describe("GET /api/product-json-import-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getImportJobV2.mockResolvedValue({
      id: "job-1",
      status: "completed",
      totalCount: 1,
      processedCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      existingBehavior: "skip",
      doTextEmbedding: false,
      doImageCaptions: false,
      doImageVectors: true,
      captionImageInput: "url",
      startedAt: "2026-03-13T09:00:00.000Z",
      createdAt: "2026-03-13T09:00:00.000Z",
      updatedAt: "2026-03-13T09:10:00.000Z",
      completedAt: "2026-03-13T09:10:00.000Z",
    });
    getFailedItemsV2.mockResolvedValue([]);
    getProcessingItemsV2.mockResolvedValue([]);
    getQueueStatsV2.mockResolvedValue({
      pendingReadyCount: 0,
      pendingDelayedCount: 0,
      processingCount: 0,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      nextRetryAt: null,
    });
    getScopedImportSummaryV2.mockResolvedValue({
      totalCount: 10,
      pendingReadyCount: 0,
      pendingDelayedCount: 0,
      processingCount: 0,
      successCount: 10,
      failedCount: 0,
      skippedCount: 0,
      nextRetryAt: null,
    });
    getVectorizeTailStats.mockResolvedValue({
      pendingCount: 2,
      processingCount: 1,
      successCount: 3,
      failedCount: 1,
      nextRetryAt: "2026-03-13T10:00:00.000Z",
    });
  });

  it("returns tail stats in job detail response", async () => {
    const req = new Request("http://localhost/api/product-json-import-v2?jobId=job-1");

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.tailStats).toEqual({
      pendingCount: 2,
      processingCount: 1,
      successCount: 3,
      failedCount: 1,
      nextRetryAt: "2026-03-13T10:00:00.000Z",
    });
  });

  it("returns normalized target summary for current run filters", async () => {
    const req = new Request(
      "http://localhost/api/product-json-import-v2?jobId=job-1&rowIndexFrom=20&rowIndexTo=10&cityCode=01101&productId=1001"
    );

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(getScopedImportSummaryV2).toHaveBeenCalledWith({
      jobId: "job-1",
      filters: {
        rowIndexFrom: 20,
        rowIndexTo: 20,
        cityCode: "01101",
        productId: "1001",
      },
    });
    expect(json.targetSummary).toEqual({
      totalCount: 10,
      pendingReadyCount: 0,
      pendingDelayedCount: 0,
      processingCount: 0,
      successCount: 10,
      failedCount: 0,
      skippedCount: 0,
      nextRetryAt: null,
    });
  });
});
