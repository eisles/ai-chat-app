import { getDb } from "@/lib/neon";

type ProductImagePayload = {
  imageUrl?: string;
  productId?: number;
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TARGET_DIM = 1536; // gpt-image-embedding-1

async function downloadImageAsBase64(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to download image: ${res.status} ${body}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return {
    dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
  };
}

async function embedWithOpenAI(imageUrl: string) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const { dataUrl } = await downloadImageAsBase64(imageUrl);
  const startedAt = Date.now();

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-image-embedding-1",
      input: [{ image: dataUrl }],
      dimensions: TARGET_DIM,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embedding failed: ${response.status} ${body}`);
  }

  const json = await response.json();
  const vector = json?.data?.[0]?.embedding as number[] | undefined;

  if (!vector || !Array.isArray(vector)) {
    throw new Error("Invalid embedding response from OpenAI");
  }
  if (vector.length !== TARGET_DIM) {
    throw new Error(
      `Unexpected embedding length: ${vector.length} (expected ${TARGET_DIM})`
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
    const { vector, durationMs, byteSize } = await embedWithOpenAI(
      targetImageUrl
    );
    const embeddingLiteral = `[${vector.join(",")}]`;

    const db = getDb();

    await db`create extension if not exists vector`;
    const createTableSQL = `
      create table if not exists product_images_openai (
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
    await db`create unique index if not exists product_images_openai_product_id_idx on product_images_openai(product_id)`;
    await db`alter table product_images_openai add column if not exists embedding_length integer`;
    await db`alter table product_images_openai add column if not exists embedding_bytes integer`;
    await db`alter table product_images_openai add column if not exists embedding_ms integer`;

    await db`
      insert into product_images_openai (product_id, image_url, embedding, embedding_length, embedding_bytes, embedding_ms)
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
      model: "gpt-image-embedding-1 (OpenAI)",
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
