import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextEmbedding = vi.fn();
const searchTextEmbeddings = vi.fn();

vi.mock("@/lib/image-text-search", () => ({
  generateTextEmbedding,
  searchTextEmbeddings,
  assertOpenAIError: () => null,
}));

process.env.OPENAI_API_KEY = "test-key";

const { POST } = await import("@/app/api/image-search/route");

describe("POST /api/image-search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 when file is missing", async () => {
    const formData = new FormData();
    const req = new Request("http://localhost/api/image-search", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported file type", async () => {
    const formData = new FormData();
    const file = new File(["test"], "note.txt", { type: "text/plain" });
    formData.append("file", file);
    const req = new Request("http://localhost/api/image-search", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns matches for valid request", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "説明文" } }],
      }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    generateTextEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      model: "text-embedding-test",
      dim: 2,
      normalized: null,
      durationMs: 12,
      byteSize: 8,
    });
    searchTextEmbeddings.mockResolvedValue([
      {
        id: "id-1",
        productId: "p-1",
        text: "テスト",
        metadata: null,
        score: 0.91,
      },
    ]);

    const formData = new FormData();
    const file = new File(["image"], "image.jpg", { type: "image/jpeg" });
    formData.append("file", file);
    formData.append("options", JSON.stringify({ top_k: 3, threshold: 0.5 }));
    const req = new Request("http://localhost/api/image-search", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.description).toBe("説明文");
    expect(json.matches).toHaveLength(1);
    expect(searchTextEmbeddings).toHaveBeenCalledWith({
      embedding: [0.1, 0.2],
      topK: 3,
      threshold: 0.5,
    });
  });
});
