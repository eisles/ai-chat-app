import { getDb } from "@/lib/neon";
import { pipeline, type Tensor } from "@xenova/transformers";

export const runtime = "nodejs";

type ProductImagePayload = {
  imageUrl?: string;
  productId?: number;
};

// ConvNeXt V2 Large produces 1536-dim features after global pooling.
const MODEL_ID = "Xenova/convnextv2-large-1k-224";
const TARGET_DIM = 1536;

async function downloadImage(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to download image: ${res.status} ${body}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

async function loadExtractor() {
  return pipeline("image-feature-extraction", MODEL_ID);
}

function meanPoolConvNext(tensor: Tensor) {
  // Expecting [1, C, H, W]
  if (tensor.dims.length !== 4) {
    throw new Error(`Unexpected tensor dims: ${tensor.dims.join("x")}`);
  }
  const [batch, channels, height, width] = tensor.dims;
  if (batch !== 1) {
    throw new Error(`Unexpected batch size: ${batch}`);
  }

  const spatial = height * width;
  const data = tensor.data as Float32Array;
  const pooled = new Float32Array(channels);

  // data layout is channels-first: (b * C + c) * H * W + h * W + w
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

  // Normalize to unit length for consistency.
  let norm = 0;
  for (let i = 0; i < pooled.length; i++) {
    norm += pooled[i]! * pooled[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < pooled.length; i++) {
    pooled[i] = pooled[i]! / norm;
  }

  return Array.from(pooled);
}

async function embedImage(imageBuffer: Buffer) {
  const extractor = await loadExtractor();
  const result = (await extractor(imageBuffer)) as Tensor;
  return meanPoolConvNext(result);
}

export async function POST(req: Request) {
  const { imageUrl, productId }: ProductImagePayload = await req.json();

  const targetImageUrl =
    imageUrl ??
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg";
  const targetProductId = productId ?? 20250519;

  try {
    const buffer = await downloadImage(targetImageUrl);
    const embedding = await embedImage(buffer);
    const embeddingLiteral = `[${embedding.join(",")}]`;

    const db = getDb();

    await db`create extension if not exists vector`;
    await db`
      create table if not exists product_images (
        product_id bigint primary key,
        image_url text not null,
        embedding vector(${TARGET_DIM}) not null,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
    `;

    await db`
      insert into product_images (product_id, image_url, embedding)
      values (${targetProductId}, ${targetImageUrl}, ${embeddingLiteral}::vector(${TARGET_DIM}))
      on conflict (product_id) do update
      set image_url = excluded.image_url,
          embedding = excluded.embedding,
          updated_at = now();
    `;

    return Response.json({
      ok: true,
      productId: targetProductId,
      imageUrl: targetImageUrl,
      embeddingLength: embedding.length,
      model: MODEL_ID,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ingestion error";

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
