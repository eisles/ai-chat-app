import { getDb } from "@/lib/neon";
import { embedOrReuseImageEmbedding } from "@/lib/vectorize-product-images";

type SearchPayload = {
  imageUrl?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

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
    const { vector, durationMs, model, dim, normalized, source, reusedFrom } =
      await embedOrReuseImageEmbedding(imageUrl, { ensureTable: false });
    const embeddingLiteral = `[${vector.join(",")}]`;

    const db = getDb();
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
      embeddingSource: source,
      embeddingReusedFrom: reusedFrom,
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
