import { beforeEach, describe, expect, it, vi } from "vitest";

const registerTextEntry = vi.fn();

vi.mock("@/lib/image-text-search", () => ({
  registerTextEntry,
  assertOpenAIError: () => null,
}));

const { POST: postText } = await import("@/app/api/texts/route");
const { POST: postBulk } = await import("@/app/api/texts/bulk/route");

describe("POST /api/texts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 when text is missing", async () => {
    const req = new Request("http://localhost/api/texts", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postText(req);
    expect(res.status).toBe(400);
  });

  it("returns registration result", async () => {
    registerTextEntry.mockResolvedValue({
      id: "id-1",
      productId: "p-1",
      textHash: "hash",
      status: "stored",
    });

    const req = new Request("http://localhost/api/texts", {
      method: "POST",
      body: JSON.stringify({ text: "登録テキスト", metadata: { source: "x" } }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postText(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.status).toBe("stored");
  });
});

describe("POST /api/texts/bulk", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 when items are missing", async () => {
    const req = new Request("http://localhost/api/texts/bulk", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postBulk(req);
    expect(res.status).toBe(400);
  });

  it("returns counts for bulk registration", async () => {
    registerTextEntry
      .mockResolvedValueOnce({
        id: "id-1",
        productId: "p-1",
        textHash: "hash-1",
        status: "stored",
      })
      .mockResolvedValueOnce({
        id: "id-2",
        productId: "p-2",
        textHash: "hash-2",
        status: "skipped",
      });

    const req = new Request("http://localhost/api/texts/bulk", {
      method: "POST",
      body: JSON.stringify({
        items: [
          { text: "A", metadata: { source: "x" } },
          { text: "B", metadata: { source: "y" } },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postBulk(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.stored).toBe(1);
    expect(json.skipped).toBe(1);
  });
});
