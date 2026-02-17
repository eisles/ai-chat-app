import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextEmbedding = vi.fn();
const searchTextEmbeddings = vi.fn();
const createCompletion = vi.fn();

const db = vi.fn(async (strings: TemplateStringsArray) => {
  const sql = strings.join(" ");
  if (sql.includes("create extension if not exists vector")) {
    return [];
  }
  if (sql.includes("from public.product_images_vectorize")) {
    return [
      {
        id: "img-1",
        city_code: null,
        product_id: "p-1",
        slide_index: 0,
        image_url: "https://example.com/a.jpg",
        distance: 0.12,
      },
    ];
  }
  return [];
});

vi.mock("@/lib/image-text-search", () => ({
  generateTextEmbedding,
  searchTextEmbeddings,
  assertOpenAIError: () => null,
}));

vi.mock("@/lib/llm-providers", () => ({
  createCompletion,
  getModelById: () => ({ supportsVision: true }),
  LLMProviderError: class LLMProviderError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/neon", () => ({
  getDb: () => db,
}));

process.env.OPENAI_API_KEY = "test-key";

const { POST } = await import("@/app/api/image-search/route");

describe("POST /api/image-search", () => {
  beforeEach(() => {
    // db などのモック実装を保持したいので resetAllMocks は使わない
    vi.clearAllMocks();
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
        embedding: new Array(512).fill(0.1),
        model: "vectorize",
        dim: 512,
        normalized: null,
      }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    createCompletion.mockResolvedValue({ content: "説明文" });
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
        cityCode: null,
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
      amountMin: null,
      amountMax: null,
    });
  });
});
