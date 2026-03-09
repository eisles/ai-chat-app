import { beforeEach, describe, expect, it, vi } from "vitest";

const runVectorMaintenanceAction = vi.fn();

vi.mock("@/lib/vectorize-product-images-maintenance", () => ({
  isVectorMaintenanceAction: (value: unknown) =>
    value === "analyze_tables" ||
    value === "rebuild_hnsw_index" ||
    value === "repair_product_slide_unique_index",
  runVectorMaintenanceAction,
}));

const { POST } = await import(
  "@/app/api/vectorize-product-images/maintenance/route"
);

describe("POST /api/vectorize-product-images/maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid action", async () => {
    const req = new Request(
      "http://localhost/api/vectorize-product-images/maintenance",
      {
        method: "POST",
        body: JSON.stringify({ action: "drop_everything" }),
      }
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it("runs the requested maintenance action", async () => {
    runVectorMaintenanceAction.mockResolvedValue({
      ok: true,
      action: "analyze_tables",
      message: "ANALYZE を実行しました。",
      executedAt: "2026-03-09T12:00:00.000Z",
    });

    const req = new Request(
      "http://localhost/api/vectorize-product-images/maintenance",
      {
        method: "POST",
        body: JSON.stringify({ action: "analyze_tables" }),
      }
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(runVectorMaintenanceAction).toHaveBeenCalledWith("analyze_tables");
    expect(json.ok).toBe(true);
    expect(json.message).toContain("ANALYZE");
  });
});
