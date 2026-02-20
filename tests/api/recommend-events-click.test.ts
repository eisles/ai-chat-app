import { beforeEach, describe, expect, it, vi } from "vitest";

const insertClickEvent = vi.fn();

vi.mock("@/lib/recommend-personalization/repository", () => ({
  insertClickEvent,
}));

const { POST } = await import("@/app/api/recommend/events/click/route");

describe("POST /api/recommend/events/click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valid payload returns ok", async () => {
    insertClickEvent.mockResolvedValue({ id: "event-1" });

    const req = new Request("http://localhost/api/recommend/events/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        productId: "p-123",
        cityCode: "01234",
        source: "recommend-assistant",
        score: 0.82,
        metadata: { queryText: "カテゴリ: 海鮮" },
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(insertClickEvent).toHaveBeenCalledWith({
      userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
      productId: "p-123",
      cityCode: "01234",
      source: "recommend-assistant",
      score: 0.82,
      metadata: { queryText: "カテゴリ: 海鮮" },
    });
  });

  it("invalid userId returns 400", async () => {
    const req = new Request("http://localhost/api/recommend/events/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "invalid",
        productId: "p-123",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(insertClickEvent).not.toHaveBeenCalled();
  });
});
