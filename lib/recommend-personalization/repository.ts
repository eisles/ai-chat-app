import { getDb } from "@/lib/neon";
import { randomUUID } from "node:crypto";

export type ClickEventInput = {
  userId: string;
  productId: string;
  cityCode?: string | null;
  source?: string | null;
  score?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type ClickEvent = {
  userId: string;
  productId: string;
  cityCode: string | null;
  score: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type ProductSignal = {
  productId: string;
  text: string;
  metadata: Record<string, unknown> | null;
};

type ClickEventRow = {
  user_id: string;
  product_id: string;
  city_code: string | null;
  score: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

type ProductSignalRow = {
  product_id: string;
  text: string;
  metadata: Record<string, unknown> | null;
};

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

export async function insertClickEvent(input: ClickEventInput): Promise<{ id: string }> {
  const db = getDb();
  const id = randomUUID();
  const source = input.source?.trim() ? input.source.trim() : "recommend-assistant";
  const metadata = normalizeMetadata(input.metadata);

  await db`
    insert into public.recommend_click_events (
      id,
      user_id,
      source,
      product_id,
      city_code,
      score,
      metadata
    )
    values (
      ${id}::uuid,
      ${input.userId}::uuid,
      ${source},
      ${input.productId},
      ${input.cityCode ?? null},
      ${input.score ?? null},
      ${metadata}
    )
  `;

  return { id };
}

export async function getRecentClicksByUser(
  userId: string,
  limit = 30
): Promise<ClickEvent[]> {
  const db = getDb();
  const rows = (await db`
    select user_id, product_id, city_code, score, metadata, created_at
    from public.recommend_click_events
    where user_id = ${userId}::uuid
    order by created_at desc
    limit ${limit}
  `) as ClickEventRow[];

  return rows.map((row) => ({
    userId: row.user_id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    score: row.score ?? null,
    metadata: normalizeMetadata(row.metadata),
    createdAt: toIsoString(row.created_at),
  }));
}

export async function getProductSignals(productIds: string[]): Promise<ProductSignal[]> {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((value) => value.trim().length > 0))
  );
  if (uniqueProductIds.length === 0) return [];

  const db = getDb();
  const rows = (await db`
    select distinct on (product_id)
      product_id,
      text,
      metadata
    from public.product_text_embeddings
    where product_id = any(${uniqueProductIds}::text[])
    order by product_id, updated_at desc nulls last
  `) as ProductSignalRow[];

  return rows.map((row) => ({
    productId: row.product_id,
    text: row.text,
    metadata: normalizeMetadata(row.metadata),
  }));
}
