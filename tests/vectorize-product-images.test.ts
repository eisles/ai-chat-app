import { beforeEach, describe, expect, it, vi } from "vitest";

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

    if (
      sql.includes("from public.product_images_vectorize") &&
      sql.includes("where image_url =")
    ) {
      if (values[0] === "https://example.com/cached.jpg") {
        return [
          {
            embedding_text: "[0.1,0.2,0.3]",
            embedding_ms: 321,
            embedding_bytes: 12,
            model: "cached-model",
            dim: 3,
            normalized: true,
            product_id: "product-1",
            slide_index: 1,
          },
        ];
      }
      return [];
    }

    return [];
  };

  return { calls, db };
});

vi.mock("@/lib/neon", () => ({
  getDb: () => mockState.db,
}));

const { embedOrReuseImageEmbedding } = await import(
  "@/lib/vectorize-product-images"
);

describe("embedOrReuseImageEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.calls.length = 0;
  });

  it("reuses stored embedding when image_url already exists", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedOrReuseImageEmbedding(
      "https://example.com/cached.jpg",
      { ensureTable: false }
    );

    expect(result.source).toBe("stored_image_url");
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.reusedFrom).toEqual({
      productId: "product-1",
      slideIndex: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Vectorize API when stored embedding is missing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://example.com/new.jpg") {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          headers: { get: () => "image/jpeg" },
          text: async () => "",
        };
      }

      return {
        ok: true,
        json: async () => ({
          embedding: new Array(512).fill(0.5),
          model: "vectorize-model",
          dim: 512,
          normalized: true,
        }),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedOrReuseImageEmbedding(
      "https://example.com/new.jpg",
      { ensureTable: false }
    );

    expect(result.source).toBe("vectorize_api");
    expect(result.vector).toHaveLength(512);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
