import { beforeEach, describe, expect, it, vi } from "vitest";

const listImportItemsV2 = vi.fn();

vi.mock("@/lib/product-json-import-v2", () => ({
  IMPORT_ITEM_STATUSES: ["pending", "processing", "success", "failed", "skipped"],
  listImportItemsV2,
}));

const { GET } = await import("@/app/api/product-json-import-v2/jobs/[jobId]/items/route");

describe("GET /api/product-json-import-v2/jobs/[jobId]/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listImportItemsV2.mockResolvedValue({
      items: [
        {
          id: "item-1",
          rowIndex: 12,
          cityCode: "01101",
          productId: "1001",
          status: "failed",
          attemptCount: 2,
          currentStep: "vectorize",
          updatedAt: "2026-03-16T06:00:00.000Z",
          error: "bad row",
          errorCode: "invalid_json",
          nextRetryAt: null,
          productJsonPreview: "{\"id\":\"1001\"}",
        },
      ],
      total: 123,
    });
  });

  it("normalizes query filters and passes them to lib", async () => {
    const req = new Request(
      "http://localhost/api/product-json-import-v2/jobs/job-1/items?limit=80&offset=40&status=failed&rowIndexFrom=20&rowIndexTo=10&cityCode=01101&productId=1001&includeProductJson=true"
    );

    const res = await GET(req, { params: Promise.resolve({ jobId: "job-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.total).toBe(123);
    expect(listImportItemsV2).toHaveBeenCalledWith({
      jobId: "job-1",
      limit: 80,
      offset: 40,
      status: "failed",
      rowIndexFrom: 20,
      rowIndexTo: 20,
      cityCode: "01101",
      productId: "1001",
      includeProductJson: true,
    });
  });
});
