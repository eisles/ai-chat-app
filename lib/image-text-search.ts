import { getDb } from "@/lib/neon";
import { createHash, randomUUID } from "crypto";

export type TextMetadata = Record<string, unknown>;

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dim: number;
  normalized: boolean | null;
  durationMs: number;
  byteSize: number;
};

export type RegisteredText = {
  id: string;
  productId: string;
  cityCode: string | null;
  textHash: string;
  status: "stored" | "updated";
};

export type DeletedText = {
  id: string;
};

export type SearchMatch = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: TextMetadata | null;
  score: number;
  amount: number | null;
};

export type ProductCategory = {
  category1_name?: string | null;
  category2_name?: string | null;
  category3_name?: string | null;
};

export type ProductPayload = {
  id: number | string;
  name?: string | null;
  description?: string | null;
  catchphrase?: string | null;
  image?: string | null;
  slide_image1?: string | null;
  slide_image2?: string | null;
  slide_image3?: string | null;
  slide_image4?: string | null;
  slide_image5?: string | null;
  slide_image6?: string | null;
  slide_image7?: string | null;
  slide_image8?: string | null;
  bulk_text?: string | null;
  application_text?: string | null;
  shipping_text?: string | null;
  allergens?: string[] | null;
  amount?: number | string | null;
  city_code?: string | null;
  city_name?: string | null;
  prefecture_name?: string | null;
  categories?: ProductCategory[] | null;
  imperfect_text?: string | null;
  imperfect_additional_text?: string | null;
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const TARGET_DIM = 1536;

class OpenAIError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 初期化フラグ（プロセス内で一度だけ実行）
let dbInitPromise: Promise<ReturnType<typeof getDb>> | null = null;

async function ensureTextEmbeddingsTable() {
  const db = getDb();

  // 既に初期化済み or 初期化中の場合はスキップ
  if (dbInitPromise) {
    return dbInitPromise;
  }

  // 初期化を開始（Promise を保存して同時実行を防ぐ）
  dbInitPromise = (async () => {
    try {
      await db`create extension if not exists vector`;
      await db`
        create table if not exists product_text_embeddings (
          id uuid primary key,
          product_id varchar(20) not null,
          city_code varchar(10),
          text text not null,
          text_source text,
          embedding vector(1536) not null,
          embedding_length integer,
          embedding_bytes integer,
          embedding_ms integer,
          model text,
          dim integer,
          normalized boolean,
          metadata jsonb,
          text_hash text unique,
          created_at timestamptz default now(),
          updated_at timestamptz default now()
        );
      `;
      await db`
        alter table product_text_embeddings
        add column if not exists city_code varchar(10)
      `;
      await db`
        alter table product_text_embeddings
        add column if not exists text_source text
      `;
      // DROP INDEX を削除（IF NOT EXISTS で十分、競合の原因になる）
      await db`
        create index if not exists product_text_embeddings_product_id_idx
          on product_text_embeddings(product_id)
      `;
      await db`
        alter table product_text_embeddings
        add column if not exists amount integer
      `;
      await db`
        create index if not exists product_text_embeddings_amount_idx
          on product_text_embeddings(amount)
      `;
      return db;
    } catch (error) {
      // エラー時は再初期化を許可
      dbInitPromise = null;
      throw error;
    }
  })();

  return dbInitPromise;
}

export function hashText(text: string, source?: string) {
  const payload = source ? `${source}:${text}` : text;
  return createHash("sha256").update(payload).digest("hex");
}

function joinNonEmpty(parts: Array<string | null | undefined>, delimiter: string) {
  return parts
    .map((part) => (part ?? "").toString().trim())
    .filter((part) => part.length > 0)
    .join(delimiter);
}

function formatCategories(categories: ProductCategory[] | null | undefined) {
  if (!categories || categories.length === 0) {
    return "";
  }
  const formatted = categories.map((category) =>
    joinNonEmpty(
      [category.category1_name, category.category2_name, category.category3_name],
      " > "
    )
  );
  return formatted.filter((entry) => entry.length > 0).join(" / ");
}

export function buildProductEmbeddingText(product: ProductPayload) {
  const cityLine = joinNonEmpty(
    [product.prefecture_name, product.city_name],
    " "
  );
  const categories = formatCategories(product.categories);
  const categoryKeywords = product.categories
    ? product.categories
        .flatMap((category) => [
          category.category1_name,
          category.category2_name,
          category.category3_name,
        ])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
        .join(" / ")
    : "";
  const allergens =
    product.allergens && product.allergens.length > 0
      ? product.allergens.join(" / ")
      : "";
  const amount =
    product.amount !== undefined && product.amount !== null
      ? `${product.amount}円`
      : "";
  const featureParts = joinNonEmpty(
    [product.bulk_text, product.imperfect_text, product.imperfect_additional_text],
    " "
  );

  const lines = [
    product.city_code ? `市町村コード: ${product.city_code}` : "",
    cityLine ? `地域名: ${cityLine}` : "",
    product.name ? `商品名: ${product.name}` : "",
    product.catchphrase ? `キャッチコピー: ${product.catchphrase}` : "",
    product.description ? `説明: ${product.description}` : "",
    featureParts ? `特徴: ${featureParts}` : "",
    categories ? `カテゴリ: ${categories}` : "",
    categoryKeywords ? `カテゴリキーワード: ${categoryKeywords}` : "",
    product.application_text ? `用途: ${product.application_text}` : "",
    product.application_text ? `用途タグ: ${product.application_text}` : "",
    amount ? `金額: ${amount}` : "",
    product.shipping_text ? `配送条件: ${product.shipping_text}` : "",
    product.shipping_text ? `配送タグ: ${product.shipping_text}` : "",
    allergens ? `アレルゲン: ${allergens}` : "",
    allergens ? `アレルゲンタグ: ${allergens}` : "",
  ];

  return lines.filter((line) => line.length > 0).join("\n");
}

export async function generateTextEmbedding(text: string): Promise<EmbeddingResult> {
  if (!OPENAI_API_KEY) {
    throw new OpenAIError("OPENAI_API_KEY is not set", 500);
  }

  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenAIError(
      `OpenAI embedding failed: ${response.status} ${body}`,
      response.status
    );
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
    model?: string;
  };
  const vector = json?.data?.[0]?.embedding;

  if (!vector || !Array.isArray(vector)) {
    throw new OpenAIError("Invalid embedding response from OpenAI", 500);
  }
  if (vector.length !== TARGET_DIM) {
    throw new OpenAIError(
      `Unexpected embedding length: ${vector.length} (expected ${TARGET_DIM})`,
      500
    );
  }

  const durationMs = Date.now() - startedAt;
  return {
    vector,
    model: json?.model ?? EMBEDDING_MODEL,
    dim: vector.length,
    normalized: null,
    durationMs,
    byteSize: vector.length * 4,
  };
}

export async function registerTextEntry(options: {
  text: string;
  metadata: TextMetadata | null;
  productId?: string;
  cityCode?: string;
  source?: string;
  useSourceInHash?: boolean;
  amount?: number | null;
}): Promise<RegisteredText> {
  const db = await ensureTextEmbeddingsTable();
  const source = options.source;
  const textHash = options.useSourceInHash
    ? hashText(options.text, source ?? "unknown")
    : hashText(options.text);

  const embedding = await generateTextEmbedding(options.text);
  const embeddingLiteral = `[${embedding.vector.join(",")}]`;
  const metadataLiteral =
    options.metadata !== null ? JSON.stringify(options.metadata) : null;
  const productId =
    options.productId ?? textHash.slice(0, 20).toLowerCase();
  const id = randomUUID();

  const rows = (await db`
    insert into product_text_embeddings (
      id,
      product_id,
      city_code,
      text,
      text_source,
      embedding,
      embedding_length,
      embedding_bytes,
      embedding_ms,
      model,
      dim,
      normalized,
      metadata,
      text_hash,
      amount
    )
    values (
      ${id},
      ${productId},
      ${options.cityCode ?? null},
      ${options.text},
      ${source ?? null},
      ${embeddingLiteral}::vector,
      ${embedding.vector.length},
      ${embedding.byteSize},
      ${embedding.durationMs},
      ${embedding.model},
      ${embedding.dim},
      ${embedding.normalized},
      ${metadataLiteral}::jsonb,
      ${textHash},
      ${options.amount ?? null}
    )
    on conflict (text_hash) do update
    set product_id = excluded.product_id,
        city_code = excluded.city_code,
        text = excluded.text,
        text_source = excluded.text_source,
        embedding = excluded.embedding,
        embedding_length = excluded.embedding_length,
        embedding_bytes = excluded.embedding_bytes,
        embedding_ms = excluded.embedding_ms,
        model = excluded.model,
        dim = excluded.dim,
        normalized = excluded.normalized,
        metadata = excluded.metadata,
        amount = excluded.amount,
        updated_at = now()
    returning id, product_id, (xmax = 0) as inserted
  `) as Array<{ id: string; product_id: string; inserted: boolean }>;

  if (rows.length === 0) {
    throw new Error("Failed to register text entry");
  }

  return {
    id: rows[0]!.id,
    productId: rows[0]!.product_id,
    cityCode: options.cityCode ?? null,
    textHash,
    status: rows[0]!.inserted ? "stored" : "updated",
  };
}

export async function searchTextEmbeddings(options: {
  embedding: number[];
  topK: number;
  threshold: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<SearchMatch[]> {
  const db = await ensureTextEmbeddingsTable();
  const embeddingLiteral = `[${options.embedding.join(",")}]`;
  const amountMin = options.amountMin ?? null;
  const amountMax = options.amountMax ?? null;

  const rows = (await db`
    select
      id,
      product_id,
      city_code,
      text,
      metadata,
      amount,
      1 - (embedding <=> ${embeddingLiteral}::vector) as score
    from product_text_embeddings
    where 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${options.threshold}
      and (${amountMin}::integer is null or amount >= ${amountMin})
      and (${amountMax}::integer is null or amount <= ${amountMax})
    order by embedding <=> ${embeddingLiteral}::vector
    limit ${options.topK}
  `) as Array<{
    id: string;
    product_id: string;
    city_code: string | null;
    text: string;
    metadata: TextMetadata | null;
    amount: number | null;
    score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.score),
    amount: row.amount ?? null,
  }));
}

export async function deleteTextEntry(id: string): Promise<DeletedText | null> {
  const db = await ensureTextEmbeddingsTable();
  const rows = (await db`
    delete from product_text_embeddings
    where id = ${id}
    returning id
  `) as Array<{ id: string }>;

  if (rows.length === 0) {
    return null;
  }

  return { id: rows[0]!.id };
}

export function assertOpenAIError(error: unknown): OpenAIError | null {
  if (error instanceof OpenAIError) {
    return error;
  }
  return null;
}
