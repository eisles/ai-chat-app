import { beforeEach, describe, expect, it, vi } from "vitest";

const runTextEmbeddingsMaintenanceAction = vi.fn();
const insertMaintenanceActionLog = vi.fn();

vi.mock("@/lib/text-embeddings-maintenance", () => ({
  isTextEmbeddingsMaintenanceAction: (value: unknown) =>
    value === "analyze_table" ||
    value === "rebuild_hnsw_index" ||
    value === "repair_amount_index" ||
    value === "refresh_category_candidates_cache",
  runTextEmbeddingsMaintenanceAction,
}));

vi.mock("@/lib/maintenance-action-log", () => ({
  buildMaintenanceRequestLogContext: () => ({
    actor: "preview",
    requestSource: "/text-embeddings/maintenance",
    metadata: {
      method: "POST",
      pathname: "/api/text-embeddings/maintenance",
    },
  }),
  insertMaintenanceActionLog,
}));

const { POST } = await import("@/app/api/text-embeddings/maintenance/route");

function createAuthorizationHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, "utf-8").toString(
    "base64"
  );
  return `Basic ${encoded}`;
}

describe("POST /api/text-embeddings/maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMaintenanceActionLog.mockResolvedValue({ id: "log-1" });
  });

  it("returns 400 for invalid action", async () => {
    const req = new Request("http://localhost/api/text-embeddings/maintenance", {
      method: "POST",
      body: JSON.stringify({ action: "drop_everything" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it("runs the requested maintenance action", async () => {
    runTextEmbeddingsMaintenanceAction.mockResolvedValue({
      ok: true,
      action: "analyze_table",
      message: "product_text_embeddings に ANALYZE を実行しました。",
      executedAt: "2026-03-09T12:00:00.000Z",
    });

    const req = new Request("http://localhost/api/text-embeddings/maintenance", {
      method: "POST",
      headers: {
        authorization: createAuthorizationHeader("preview", "secret"),
        "x-maintenance-source": "/text-embeddings/maintenance",
      },
      body: JSON.stringify({ action: "analyze_table" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(runTextEmbeddingsMaintenanceAction).toHaveBeenCalledWith(
      "analyze_table"
    );
    expect(insertMaintenanceActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "product_text_embeddings",
        action: "analyze_table",
        status: "success",
        actor: "preview",
        requestSource: "/text-embeddings/maintenance",
      })
    );
    expect(json.ok).toBe(true);
    expect(json.message).toContain("ANALYZE");
  });
});
