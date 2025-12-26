import { getDb } from "@/lib/neon";

type ProductImagePayload = {
  imageUrl?: string;
  productId?: number;
};

const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const TARGET_DIM = 1408; // imageembedding-001 outputs 1408-dim

async function downloadImageAsBase64(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to download image: ${res.status} ${body}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return {
    base64: buffer.toString("base64"),
    mimeType: contentType,
  };
}

async function embedWithGemini(imageUrl: string) {
  if (!GEMINI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }

  const { base64, mimeType } = await downloadImageAsBase64(imageUrl);
  const startedAt = Date.now();

  // Gemini 1.5 Flash embedContent supports images; returns 1408-dim vector.
  // Official image embedding model (1408 dims). Works with v1beta embedImage.
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/image-embedding-001:embedImage";

  const payload = JSON.stringify({
    image: {
      inlineData: {
        data: base64,
        mimeType,
      },
    },
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: payload,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embedding failed: ${response.status} ${body}`);
  }

  const json = await response.json();
  const vector =
    (json?.embedding?.values as number[] | undefined) ??
    (json?.embedding?.value as number[] | undefined);

  if (!vector || !Array.isArray(vector)) {
    throw new Error("Invalid embedding response from Gemini");
  }
  if (vector.length !== TARGET_DIM) {
    throw new Error(
      `Unexpected embedding length: ${vector.length} (expected ${TARGET_DIM}).`,
    );
  }

  const durationMs = Date.now() - startedAt;
  return { vector, durationMs, byteSize: vector.length * 4 };
}

export async function POST(req: Request) {
  const { imageUrl, productId }: ProductImagePayload = await req.json();

  const targetImageUrl =
    imageUrl ??
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg";
  const targetProductId = productId ?? 20250519;

  try {
    const { vector, durationMs, byteSize } = await embedWithGemini(
      targetImageUrl
    );
    const embeddingLiteral = `[${vector.join(",")}]`;

    const db = getDb();

    await db`create extension if not exists vector`;
    const createTableSQL = `
      create table if not exists product_images_gemini (
        product_id bigint primary key,
        image_url text not null,
        embedding vector(${TARGET_DIM}) not null,
        embedding_length integer,
        embedding_bytes integer,
        embedding_ms integer,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
    `;
    await (db as any).unsafe(createTableSQL);
    await db`create unique index if not exists product_images_gemini_product_id_idx on product_images_gemini(product_id)`;
    await db`alter table product_images_gemini add column if not exists embedding_length integer`;
    await db`alter table product_images_gemini add column if not exists embedding_bytes integer`;
    await db`alter table product_images_gemini add column if not exists embedding_ms integer`;

    await db`
      insert into product_images_gemini (product_id, image_url, embedding, embedding_length, embedding_bytes, embedding_ms)
      values (${targetProductId}, ${targetImageUrl}, ${embeddingLiteral}::vector, ${vector.length}, ${byteSize}, ${durationMs})
      on conflict (product_id) do update
      set image_url = excluded.image_url,
          embedding = excluded.embedding,
          embedding_length = excluded.embedding_length,
          embedding_bytes = excluded.embedding_bytes,
          embedding_ms = excluded.embedding_ms,
          updated_at = now();
    `;

    return Response.json({
      ok: true,
      productId: targetProductId,
      imageUrl: targetImageUrl,
      embeddingLength: vector.length,
      embeddingByteSize: byteSize,
      embeddingDurationMs: durationMs,
      model: "image-embedding-001 (Gemini)",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ingestion error";

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
