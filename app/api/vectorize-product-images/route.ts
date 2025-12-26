import { getDb } from "@/lib/neon";
import { randomBytes } from "node:crypto";

type ProductImagePayload = {
  imageUrl?: string;
  productId?: string;
  cityCode?: string;
};

const TARGET_DIM = 512;
const VECTORIZE_ENDPOINT = "https://convertvectorapi.onrender.com/vectorize";
const TABLE_NAME = "public.product_images_vectorize";

function generateUuidV7() {
  const timeMs = BigInt(Date.now());
  const timeBytes = Buffer.alloc(6);
  let remaining = timeMs;
  for (let i = 5; i >= 0; i -= 1) {
    timeBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  const randomBytesValue = randomBytes(10);
  const bytes = Buffer.concat([timeBytes, randomBytesValue]);

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
    byteSize: vector.length * 4,
    model: json?.model ?? "unknown",
    dim: json?.dim ?? vector.length,
    normalized: json?.normalized ?? null,
  };
}

export async function POST(req: Request) {
  const { imageUrl, productId, cityCode }: ProductImagePayload = await req.json();

  const targetImageUrl =
    imageUrl ??
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg";
  const targetProductId = productId ?? "20250519";
  const targetCityCode = cityCode ?? null;

  try {
    const id = generateUuidV7();
    const { vector, durationMs, byteSize, model, dim, normalized } =
      await embedWithVectorizeApi(targetImageUrl);
    const embeddingLiteral = `[${vector.join(",")}]`;

    const db = getDb();

    await db`create extension if not exists vector`;

    const insertVector = async () =>
      db`
        insert into public.product_images_vectorize (
        id,
        city_code,
        product_id,
        image_url,
        embedding,
        embedding_length,
        embedding_bytes,
        embedding_ms,
        model,
        dim,
        normalized
        )
        values (
        ${id},
        ${targetCityCode},
        ${targetProductId},
        ${targetImageUrl},
        ${embeddingLiteral}::vector,
        ${vector.length},
        ${byteSize},
        ${durationMs},
        ${model},
        ${dim},
        ${normalized}
        )
        on conflict (product_id) do update
        set image_url = excluded.image_url,
            embedding = excluded.embedding,
            embedding_length = excluded.embedding_length,
            embedding_bytes = excluded.embedding_bytes,
            embedding_ms = excluded.embedding_ms,
            model = excluded.model,
            dim = excluded.dim,
            normalized = excluded.normalized,
            updated_at = now();
      `;

    await insertVector();

    return Response.json({
      ok: true,
      id,
      cityCode: targetCityCode ?? undefined,
      productId: targetProductId,
      imageUrl: targetImageUrl,
      embeddingLength: vector.length,
      embeddingByteSize: byteSize,
      embeddingDurationMs: durationMs,
      model,
      dim,
      normalized,
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
