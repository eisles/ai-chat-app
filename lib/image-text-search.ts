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
  textHash: string;
  status: "stored" | "skipped";
};

export type SearchMatch = {
  id: string;
  productId: string;
  text: string;
  metadata: TextMetadata | null;
  score: number;
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

async function ensureTextEmbeddingsTable() {
  const db = getDb();
  await db`create extension if not exists vector`;
  await db`
    create table if not exists product_text_embeddings (
      id uuid primary key,
      product_id varchar(20) not null,
      text text not null,
      embedding vector(${TARGET_DIM}) not null,
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
    create unique index if not exists product_text_embeddings_product_id_idx
      on product_text_embeddings(product_id)
  `;
  return db;
}

export function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
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
}): Promise<RegisteredText> {
  const db = await ensureTextEmbeddingsTable();
  const textHash = hashText(options.text);

  const existing = (await db`
    select id, product_id
    from product_text_embeddings
    where text_hash = ${textHash}
    limit 1
  `) as Array<{ id: string; product_id: string }>;

  if (existing.length > 0) {
    return {
      id: existing[0]!.id,
      productId: existing[0]!.product_id,
      textHash,
      status: "skipped",
    };
  }

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
      text,
      embedding,
      embedding_length,
      embedding_bytes,
      embedding_ms,
      model,
      dim,
      normalized,
      metadata,
      text_hash
    )
    values (
      ${id},
      ${productId},
      ${options.text},
      ${embeddingLiteral}::vector,
      ${embedding.vector.length},
      ${embedding.byteSize},
      ${embedding.durationMs},
      ${embedding.model},
      ${embedding.dim},
      ${embedding.normalized},
      ${metadataLiteral}::jsonb,
      ${textHash}
    )
    returning id, product_id
  `) as Array<{ id: string; product_id: string }>;

  if (rows.length === 0) {
    throw new Error("Failed to register text entry");
  }

  return {
    id: rows[0]!.id,
    productId: rows[0]!.product_id,
    textHash,
    status: "stored",
  };
}

export async function searchTextEmbeddings(options: {
  embedding: number[];
  topK: number;
  threshold: number;
}): Promise<SearchMatch[]> {
  const db = await ensureTextEmbeddingsTable();
  const embeddingLiteral = `[${options.embedding.join(",")}]`;

  const rows = (await db`
    select
      id,
      product_id,
      text,
      metadata,
      1 - (embedding <=> ${embeddingLiteral}::vector) as score
    from product_text_embeddings
    where 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${options.threshold}
    order by embedding <=> ${embeddingLiteral}::vector
    limit ${options.topK}
  `) as Array<{
    id: string;
    product_id: string;
    text: string;
    metadata: TextMetadata | null;
    score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.score),
  }));
}

export function assertOpenAIError(error: unknown): OpenAIError | null {
  if (error instanceof OpenAIError) {
    return error;
  }
  return null;
}
