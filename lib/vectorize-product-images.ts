import { getDb } from "@/lib/neon";
import { randomBytes } from "crypto";

type ImageVector = {
  vector: number[];
  durationMs: number;
  byteSize: number;
  model: string;
  dim: number;
  normalized: boolean | null;
};

type SlideVector = {
  url: string | null;
  embedding: ImageVector | null;
  slideIndex: number;
};

const DEFAULT_VECTORIZE_ENDPOINT = "https://convertvectorapi.onrender.com/vectorize";
const VECTORIZE_ENDPOINT =
  process.env.VECTORIZE_ENDPOINT ?? DEFAULT_VECTORIZE_ENDPOINT;
const TARGET_DIM = 512;

function generateUuidV7() {
  let timeMs = Date.now();
  const timeBytes = Buffer.alloc(6);
  for (let i = 5; i >= 0; i -= 1) {
    timeBytes[i] = timeMs % 256;
    timeMs = Math.floor(timeMs / 256);
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

export async function embedWithVectorizeApi(imageUrl: string) {
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

async function ensureProductImagesVectorizeTable() {
  const db = getDb();
  await db`create extension if not exists vector`;
  await db`
    create table if not exists public.product_images_vectorize (
      id uuid primary key,
      city_code varchar(10),
      product_id varchar(20) not null,
      slide_index integer not null default 0,
      image_url text,
      embedding vector(512),
      embedding_length integer,
      embedding_bytes integer,
      embedding_ms integer,
      model text,
      dim integer,
      normalized boolean,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `;

  await db`
    alter table public.product_images_vectorize
    add column if not exists slide_index integer not null default 0
  `;

  return db;
}

export async function ensureProductImagesVectorizeInitialized() {
  await ensureProductImagesVectorizeTable();
}

function vectorLiteral(vector?: number[] | null) {
  if (!vector || vector.length === 0) {
    return null;
  }
  return `[${vector.join(",")}]`;
}

export async function deleteProductImagesVectorize(options: {
  productId: string;
}): Promise<number> {
  const db = await ensureProductImagesVectorizeTable();
  const rows = (await db`
    delete from public.product_images_vectorize
    where product_id = ${options.productId}
    returning id
  `) as Array<{ id: string }>;
  return rows.length;
}

export async function upsertProductImagesVectorize(options: {
  productId: string;
  cityCode?: string | null;
  imageUrl?: string | null;
  imageEmbedding?: ImageVector | null;
  slideIndex: number;
}) {
  const db = await ensureProductImagesVectorizeTable();

  const embeddingLiteral = vectorLiteral(options.imageEmbedding?.vector ?? null);

  const updated = (await db`
    update public.product_images_vectorize
    set city_code = ${options.cityCode ?? null},
        image_url = ${options.imageUrl ?? null},
        embedding = ${embeddingLiteral}::vector,
        embedding_length = ${options.imageEmbedding?.vector.length ?? null},
        embedding_bytes = ${options.imageEmbedding?.byteSize ?? null},
        embedding_ms = ${options.imageEmbedding?.durationMs ?? null},
        model = ${options.imageEmbedding?.model ?? null},
        dim = ${options.imageEmbedding?.dim ?? null},
        normalized = ${options.imageEmbedding?.normalized ?? null},
        updated_at = now()
    where product_id = ${options.productId}
      and slide_index = ${options.slideIndex}
    returning id
  `) as Array<{ id: string }>;

  if (updated.length > 0) {
    return;
  }

  const id = generateUuidV7();
  await db`
    insert into public.product_images_vectorize (
      id,
      city_code,
      product_id,
      slide_index,
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
      ${options.cityCode ?? null},
      ${options.productId},
      ${options.slideIndex},
      ${options.imageUrl ?? null},
      ${embeddingLiteral}::vector,
      ${options.imageEmbedding?.vector.length ?? null},
      ${options.imageEmbedding?.byteSize ?? null},
      ${options.imageEmbedding?.durationMs ?? null},
      ${options.imageEmbedding?.model ?? null},
      ${options.imageEmbedding?.dim ?? null},
      ${options.imageEmbedding?.normalized ?? null}
    )
  `;
}

export async function vectorizeProductImages(options: {
  productId: string;
  cityCode?: string | null;
  imageUrl?: string | null;
  slideImageUrls?: Array<string | null | undefined>;
}) {
  const hasMain = Boolean(options.imageUrl && options.imageUrl.trim());
  const hasSlides = (options.slideImageUrls ?? []).some(
    (url) => url && url.trim()
  );
  if (!hasMain && !hasSlides) {
    return;
  }

  const mainEmbedding = options.imageUrl
    ? await embedWithVectorizeApi(options.imageUrl)
    : null;

  const slides: SlideVector[] = [];
  const slideUrls = options.slideImageUrls ?? [];
  for (const [index, url] of slideUrls.entries()) {
    if (!url || !url.trim()) {
      slides.push({ url: null, embedding: null, slideIndex: index + 1 });
      continue;
    }
    const embedding = await embedWithVectorizeApi(url);
    slides.push({ url, embedding, slideIndex: index + 1 });
  }

  if (mainEmbedding) {
    await upsertProductImagesVectorize({
      productId: options.productId,
      cityCode: options.cityCode ?? null,
      imageUrl: options.imageUrl ?? null,
      imageEmbedding: mainEmbedding,
      slideIndex: 0,
    });
  }

  for (const slide of slides) {
    if (!slide.url || !slide.embedding) {
      continue;
    }
    await upsertProductImagesVectorize({
      productId: options.productId,
      cityCode: options.cityCode ?? null,
      imageUrl: slide.url,
      imageEmbedding: slide.embedding,
      slideIndex: slide.slideIndex,
    });
  }

}

export async function checkExistingProductImagesVectorize(options: {
  productId: string;
}): Promise<boolean> {
  const db = await ensureProductImagesVectorizeTable();
  const rows = (await db`
    select 1 from public.product_images_vectorize
    where product_id = ${options.productId}
    limit 1
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

export async function getExistingVectorizedProductIds(options: {
  productIds: string[];
}): Promise<Set<string>> {
  const db = await ensureProductImagesVectorizeTable();
  const uniqueProductIds = Array.from(new Set(options.productIds)).filter(
    (id) => typeof id === "string" && id.trim().length > 0
  );
  if (uniqueProductIds.length === 0) {
    return new Set();
  }

  const rows = (await db`
    select distinct product_id
    from public.product_images_vectorize
    where product_id = any(${uniqueProductIds}::text[])
  `) as Array<{ product_id: string }>;

  return new Set(rows.map((row) => row.product_id));
}
