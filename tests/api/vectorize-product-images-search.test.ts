import { beforeEach, describe, expect, it, vi } from "vitest";

const embedOrReuseImageEmbedding = vi.fn();

type SqlCall = {
  sql: string;
  values: unknown[];
};

const mockState = vi.hoisted(() => {
  const calls: SqlCall[] = [];
  const db = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.reduce((acc, part, idx) => {
      const placeholder = idx < values.length ? `$${idx + 1}` : "";
      return `${acc}${part}${placeholder}`;
    }, "");
    calls.push({ sql, values });

    if (sql.includes("from public.product_images_vectorize")) {
      return [
        {
          id: "img-1",
          city_code: "13101",
          product_id: "p-1",
          slide_index: 0,
          image_url: "https://example.com/result.jpg",
          distance: 0.12,
          metadata: { raw: { name: "商品A" } },
          amount: 10000,
        },
      ];
    }

    return [];
  };

  return { calls, db };
});

vi.mock("@/lib/vectorize-product-images", () => ({
  embedOrReuseImageEmbedding,
}));

vi.mock("@/lib/neon", () => ({
  getDb: () => mockState.db,
}));

const { POST } = await import("@/app/api/vectorize-product-images/search/route");

describe("POST /api/vectorize-product-images/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.calls.length = 0;
  });

  it("returns 400 when imageUrl is missing", async () => {
    const req = new Request("http://localhost/api/vectorize-product-images/search", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("uses shared embedding helper and skips hot path initialization sql", async () => {
    embedOrReuseImageEmbedding.mockResolvedValue({
      vector: new Array(512).fill(0.1),
      durationMs: 0,
      byteSize: 2048,
      model: "cached-model",
      dim: 512,
      normalized: true,
      source: "stored_image_url",
      reusedFrom: {
        productId: "cached-product",
        slideIndex: 2,
      },
    });

    const req = new Request("http://localhost/api/vectorize-product-images/search", {
      method: "POST",
      body: JSON.stringify({
        imageUrl: "https://example.com/query.jpg",
        limit: 12,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(embedOrReuseImageEmbedding).toHaveBeenCalledWith(
      "https://example.com/query.jpg",
      { ensureTable: false }
    );
    expect(json.ok).toBe(true);
    expect(json.embeddingSource).toBe("stored_image_url");
    expect(json.embeddingReusedFrom).toEqual({
      productId: "cached-product",
      slideIndex: 2,
    });
    expect(json.results).toHaveLength(1);
    expect(
      mockState.calls.some((call) =>
        call.sql.includes("create extension if not exists vector")
      )
    ).toBe(false);
  });
});
