import { beforeEach, describe, expect, it, vi } from "vitest";

const runVectorMaintenanceAction = vi.fn();
const insertMaintenanceActionLog = vi.fn();

vi.mock("@/lib/vectorize-product-images-maintenance", () => ({
  isVectorMaintenanceAction: (value: unknown) =>
    value === "analyze_tables" ||
    value === "rebuild_hnsw_index" ||
    value === "repair_product_slide_unique_index",
  runVectorMaintenanceAction,
}));

vi.mock("@/lib/maintenance-action-log", () => ({
  buildMaintenanceRequestLogContext: () => ({
    actor: "preview",
    requestSource: "/product-images-vectorize/maintenance",
    metadata: {
      method: "POST",
      pathname: "/api/vectorize-product-images/maintenance",
    },
  }),
  insertMaintenanceActionLog,
}));

const { POST } = await import(
  "@/app/api/vectorize-product-images/maintenance/route"
);

function createAuthorizationHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, "utf-8").toString(
    "base64"
  );
  return `Basic ${encoded}`;
}

describe("POST /api/vectorize-product-images/maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMaintenanceActionLog.mockResolvedValue({ id: "log-1" });
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
        headers: {
          authorization: createAuthorizationHeader("preview", "secret"),
          "x-maintenance-source": "/product-images-vectorize/maintenance",
        },
        body: JSON.stringify({ action: "analyze_tables" }),
      }
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(runVectorMaintenanceAction).toHaveBeenCalledWith("analyze_tables");
    expect(insertMaintenanceActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "product_images_vectorize",
        action: "analyze_tables",
        status: "success",
        actor: "preview",
        requestSource: "/product-images-vectorize/maintenance",
      })
    );
    expect(json.ok).toBe(true);
    expect(json.message).toContain("ANALYZE");
  });

  it("records an error log when maintenance action fails", async () => {
    runVectorMaintenanceAction.mockRejectedValue(new Error("boom"));

    const req = new Request(
      "http://localhost/api/vectorize-product-images/maintenance",
      {
        method: "POST",
        headers: {
          authorization: createAuthorizationHeader("preview", "secret"),
          "x-maintenance-source": "/product-images-vectorize/maintenance",
        },
        body: JSON.stringify({ action: "rebuild_hnsw_index" }),
      }
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(insertMaintenanceActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "product_images_vectorize",
        action: "rebuild_hnsw_index",
        status: "error",
        actor: "preview",
        requestSource: "/product-images-vectorize/maintenance",
        error: "boom",
      })
    );
    expect(json.ok).toBe(false);
  });
});
