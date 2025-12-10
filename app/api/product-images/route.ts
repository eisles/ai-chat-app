import { getDb } from "@/lib/neon";
import { pipeline, type Tensor } from "@xenova/transformers";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";

export const runtime = "nodejs";

type ProductImagePayload = {
  imageUrl?: string;
  productId?: number;
};

// CLIP ViT-L/14 returns a 768-dim embedding.
const MODEL_ID = "Xenova/clip-vit-large-patch14";
const TARGET_DIM = 768;

async function loadExtractor() {
  return pipeline("image-feature-extraction", MODEL_ID);
}

function normalizeVector(vec: Float32Array) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) {
    vec[i] = vec[i]! / norm;
  }
  return Array.from(vec);
}

async function embedImage(imageUrl: string) {
  // 画像を取得して Buffer をパイプラインに渡す。
  const res = await fetch(imageUrl);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to download image: ${res.status} ${body}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());

  const ext =
    contentType.includes("png") ? ".png" :
    contentType.includes("webp") ? ".webp" :
    contentType.includes("gif") ? ".gif" :
    ".jpg";
  const tmpPath = path.join(tmpdir(), `image-${randomUUID()}${ext}`);
  await fs.writeFile(tmpPath, buffer);

  const extractor = await loadExtractor();
  let output: unknown;
  try {
    // Ask pipeline to mean-pool CLS embedding.
    output = (await extractor(tmpPath, {
      pooling: "mean",
      normalize: false,
    })) as unknown;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  // The pipeline usually returns a Tensor; handle both direct Tensor and array.
  const tensor =
    typeof output === "object" &&
    output !== null &&
    "data" in (output as Tensor) &&
    "dims" in (output as Tensor)
      ? (output as Tensor)
      : Array.isArray(output) &&
        output[0] &&
        typeof output[0] === "object" &&
        "data" in (output[0] as Tensor) &&
        "dims" in (output[0] as Tensor)
        ? (output[0] as Tensor)
        : null;

  if (!tensor) {
    throw new Error("Unexpected extractor output");
  }

  // If already pooled: [1, D]
  if (tensor.dims.length === 2 && tensor.dims[0] === 1) {
    const vec = tensor.data as Float32Array;
    if (tensor.dims[1] !== TARGET_DIM) {
      throw new Error(
        `Unexpected embedding length: ${tensor.dims[1]} (expected ${TARGET_DIM}).`,
      );
    }
    return normalizeVector(vec);
  }

  // If feature map: [1, C, H, W], pool spatial dims.
  if (tensor.dims.length === 4) {
    const [batch, channels, height, width] = tensor.dims;
    if (batch !== 1) {
      throw new Error(`Unexpected batch size: ${batch}`);
    }
    const spatial = height * width;
    const data = tensor.data as Float32Array;
    const pooled = new Float32Array(channels);
    for (let c = 0; c < channels; c++) {
      let sum = 0;
      const channelOffset = c * height * width;
      for (let i = 0; i < height * width; i++) {
        sum += data[channelOffset + i];
      }
      pooled[c] = sum / spatial;
    }
    if (pooled.length !== TARGET_DIM) {
      throw new Error(`Unexpected pooled length: ${pooled.length}`);
    }
    return normalizeVector(pooled);
  }

  throw new Error(`Unexpected tensor dims: ${tensor.dims.join("x")}`);
}

export async function POST(req: Request) {
  const { imageUrl, productId }: ProductImagePayload = await req.json();

  const targetImageUrl =
    imageUrl ??
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg";
  const targetProductId = productId ?? 20250519;

  try {
    const startedAt = Date.now();
    const embedding = await embedImage(targetImageUrl);
    const embeddingDurationMs = Date.now() - startedAt;
    const embeddingByteSize = embedding.length * 4; // float32 = 4 bytes
    const embeddingLiteral = `[${embedding.join(",")}]`;

    const db = getDb();

    await db`create extension if not exists vector`;
    const createTableSQL = `
      create table if not exists product_images (
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
    await db`create unique index if not exists product_images_product_id_idx on product_images(product_id)`;
    await db`alter table product_images add column if not exists embedding_length integer`;
    await db`alter table product_images add column if not exists embedding_bytes integer`;
    await db`alter table product_images add column if not exists embedding_ms integer`;

    await db`
      insert into product_images (product_id, image_url, embedding, embedding_length, embedding_bytes, embedding_ms)
      values (${targetProductId}, ${targetImageUrl}, ${embeddingLiteral}::vector, ${embedding.length}, ${embeddingByteSize}, ${embeddingDurationMs})
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
      embeddingLength: embedding.length,
      model: MODEL_ID,
      embeddingDurationMs,
      embeddingByteSize,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ingestion error";

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
