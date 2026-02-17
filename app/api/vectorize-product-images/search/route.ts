import { getDb } from "@/lib/neon";
import { ensureProductTextEmbeddingsInitialized } from "@/lib/image-text-search";

type SearchPayload = {
  imageUrl?: string;
  limit?: number;
};

const TARGET_DIM = 512;
const VECTORIZE_ENDPOINT = "https://convertvectorapi.onrender.com/vectorize";
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

async function downloadImageAsBlob(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to download image: ${res.status} ${body}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.split("/")[1] ?? "jpg";
  const filename = `image.${ext}`;
  const blob = new Blob([buffer], { type: contentType });

  return { blob, filename };
}

async function embedWithVectorizeApi(imageUrl: string) {
  const { blob, filename } = await downloadImageAsBlob(imageUrl);
  const startedAt = Date.now();

  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("options", JSON.stringify({ timeout_ms: 20000 }));

  const response = await fetch(VECTORIZE_ENDPOINT, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vectorize API failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as {
    embedding?: number[];
    model?: string;
    dim?: number;
    normalized?: boolean;
  };

  const vector = json?.embedding;
  if (!vector || !Array.isArray(vector)) {
    throw new Error("Invalid embedding response from Vectorize API");
  }
  if (vector.length !== TARGET_DIM) {
    throw new Error(
      `Unexpected embedding length: ${vector.length} (expected ${TARGET_DIM})`
    );
  }
  if (typeof json?.dim === "number" && json.dim !== TARGET_DIM) {
    throw new Error(
      `Unexpected embedding dim: ${json.dim} (expected ${TARGET_DIM})`
    );
  }

  const durationMs = Date.now() - startedAt;
  return {
    vector,
    durationMs,
    model: json?.model ?? "unknown",
    dim: json?.dim ?? vector.length,
    normalized: json?.normalized ?? null,
  };
}

export async function POST(req: Request) {
  const { imageUrl, limit }: SearchPayload = await req.json();

  if (!imageUrl) {
    return Response.json(
      { ok: false, error: "imageUrl is required" },
      { status: 400 }
    );
  }

  const safeLimit = Math.max(
    1,
    Math.min(Number(limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  );

  try {
    const { vector, durationMs, model, dim, normalized } =
      await embedWithVectorizeApi(imageUrl);
    const embeddingLiteral = `[${vector.join(",")}]`;

    await ensureProductTextEmbeddingsInitialized();
    const db = getDb();
    await db`create extension if not exists vector`;

    const rows = (await db`
      select
        v.id,
        v.city_code,
        v.product_id,
        v.slide_index,
        v.image_url,
        v.embedding <-> ${embeddingLiteral}::vector as distance,
        t.metadata,
        t.amount
      from public.product_images_vectorize v
      left join lateral (
        select metadata, amount
        from public.product_text_embeddings
        where product_id = v.product_id
          and text_source = 'product_json'
        order by updated_at desc nulls last
        limit 1
      ) t on true
      order by v.embedding <-> ${embeddingLiteral}::vector
      limit ${safeLimit}
    `) as Array<{
      id: string;
      city_code: string | null;
      product_id: string | null;
      slide_index: number | null;
      image_url: string;
      distance: number;
      metadata: Record<string, unknown> | null;
      amount: number | null;
    }>;

    return Response.json({
      ok: true,
      queryImageUrl: imageUrl,
      embeddingDurationMs: durationMs,
      model,
      dim,
      normalized,
      results: rows,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown search error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
