import { ensureProductTextEmbeddingsInitialized } from "@/lib/image-text-search";
import { getDb } from "@/lib/neon";
import {
  ensureProductImagesVectorizeInitialized,
  getVectorizedSlideIndexes,
} from "@/lib/vectorize-product-images";
import type { ExistingProductBehavior } from "@/lib/product-import-behavior";
import { randomUUID } from "crypto";

export const INSERT_IMPORT_ITEMS_BATCH_SIZE = 1000;
export const DOWNSTREAM_DELETE_BATCH_SIZE = 500;

export const CAPTION_IMAGE_INPUT_MODES = ["url", "data_url"] as const;
export type CaptionImageInputMode = (typeof CAPTION_IMAGE_INPUT_MODES)[number];

export type ImportJobV2 = {
  id: string;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  existingBehavior: ExistingProductBehavior;
  doTextEmbedding: boolean;
  doImageCaptions: boolean;
  doImageVectors: boolean;
  captionImageInput: CaptionImageInputMode;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ImportQueueStatsV2 = {
  pendingReadyCount: number;
  pendingDelayedCount: number;
  processingCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  nextRetryAt: string | null;
};

export type VectorizeTailItem = {
  id: string;
  jobId: string;
  importItemId: string;
  productId: string;
  cityCode: string | null;
  imageUrl: string;
  slideIndex: number;
  status: "pending" | "processing" | "success" | "failed";
  attemptCount: number;
  nextRetryAt: string | null;
  error: string | null;
  errorCode: string | null;
  processingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VectorizeTailStats = {
  pendingCount: number;
  processingCount: number;
  successCount: number;
  failedCount: number;
  nextRetryAt: string | null;
};

export type ImportJobSummaryV2 = {
  id: string;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  existingBehavior: ExistingProductBehavior;
  doTextEmbedding: boolean;
  doImageCaptions: boolean;
  doImageVectors: boolean;
  captionImageInput: CaptionImageInputMode;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

let ensureProductImportTablesV2Promise: Promise<void> | null = null;

async function initializeProductImportTablesV2(
  db: ReturnType<typeof getDb>
): Promise<void> {
  await db`
    create table if not exists public.product_import_jobs_v2 (
      id uuid primary key,
      status text not null,
      total_count integer not null,
      processed_count integer not null,
      success_count integer not null,
      failure_count integer not null,
      skipped_count integer not null default 0,
      existing_behavior text not null default 'skip',
      do_text_embedding boolean not null default true,
      do_image_captions boolean not null default true,
      do_image_vectors boolean not null default true,
      caption_image_input text not null default 'url',
      started_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      completed_at timestamptz
    );
  `;
  // 既存環境向け: 途中でカラムが増えても問題ないようにする
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists completed_at timestamptz
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists existing_behavior text not null default 'skip'
  `;
  await db`
    alter table public.product_import_jobs_v2
    alter column existing_behavior set default 'skip'
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists skipped_count integer not null default 0
  `;
  await db`
    alter table public.product_import_jobs_v2
    alter column skipped_count set default 0
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists do_text_embedding boolean not null default true
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists do_image_captions boolean not null default true
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists do_image_vectors boolean not null default true
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists caption_image_input text not null default 'url'
  `;
  await db`
    alter table public.product_import_jobs_v2
    alter column caption_image_input set default 'url'
  `;
  await db`
    alter table public.product_import_jobs_v2
    add column if not exists started_at timestamptz
  `;

  await db`
    create table if not exists public.product_import_items_v2 (
      id uuid primary key,
      job_id uuid not null references public.product_import_jobs_v2(id) on delete cascade,
      row_index integer not null,
      city_code text,
      product_id text,
      product_json text not null,
      status text not null,
      error text,
      attempt_count integer not null default 0,
      next_retry_at timestamptz,
      error_code text,
      processing_started_at timestamptz,
      current_step text,
      current_step_detail text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `;
  // 既存環境向け: 途中でカラムが増えても問題ないようにする
  await db`
    alter table public.product_import_items_v2
    add column if not exists attempt_count integer not null default 0
  `;
  await db`
    alter table public.product_import_items_v2
    alter column attempt_count set default 0
  `;
  await db`
    alter table public.product_import_items_v2
    add column if not exists next_retry_at timestamptz
  `;
  await db`
    alter table public.product_import_items_v2
    add column if not exists error_code text
  `;
  await db`
    alter table public.product_import_items_v2
    add column if not exists processing_started_at timestamptz
  `;
  await db`
    alter table public.product_import_items_v2
    add column if not exists current_step text
  `;
  await db`
    alter table public.product_import_items_v2
    add column if not exists current_step_detail text
  `;
  await db`
    create index if not exists product_import_items_v2_job_status_idx
      on public.product_import_items_v2(job_id, status, row_index)
  `;
  await db`
    create index if not exists product_import_items_v2_retry_idx
      on public.product_import_items_v2(job_id, status, next_retry_at, row_index)
  `;

  await db`
    create table if not exists public.product_import_vectorize_tail_items (
      id uuid primary key,
      job_id uuid not null references public.product_import_jobs_v2(id) on delete cascade,
      import_item_id uuid not null references public.product_import_items_v2(id) on delete cascade,
      product_id text not null,
      city_code text,
      image_url text not null,
      slide_index integer not null,
      status text not null default 'pending',
      error text,
      attempt_count integer not null default 0,
      next_retry_at timestamptz,
      error_code text,
      processing_started_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    add column if not exists attempt_count integer not null default 0
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    alter column attempt_count set default 0
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    add column if not exists next_retry_at timestamptz
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    add column if not exists error_code text
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    add column if not exists processing_started_at timestamptz
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    add column if not exists created_at timestamptz not null default now()
  `;
  await db`
    alter table public.product_import_vectorize_tail_items
    add column if not exists updated_at timestamptz not null default now()
  `;
  await db`
    do $$
    begin
      if not exists (
        select 1
        from pg_constraint
        where conname = 'product_import_vectorize_tail_items_unique_item_slide'
      ) then
        alter table public.product_import_vectorize_tail_items
        add constraint product_import_vectorize_tail_items_unique_item_slide
        unique (import_item_id, slide_index);
      end if;
    end
    $$;
  `;
  await db`
    create index if not exists product_import_vectorize_tail_items_job_status_idx
      on public.product_import_vectorize_tail_items(job_id, status, next_retry_at, slide_index)
  `;
  await db`
    create index if not exists product_import_vectorize_tail_items_product_status_idx
      on public.product_import_vectorize_tail_items(product_id, status, slide_index)
  `;
}

export async function ensureProductImportTablesV2() {
  const db = getDb();
  if (!ensureProductImportTablesV2Promise) {
    ensureProductImportTablesV2Promise = initializeProductImportTablesV2(db).catch(
      (error) => {
        ensureProductImportTablesV2Promise = null;
        throw error;
      }
    );
  }
  await ensureProductImportTablesV2Promise;
  return db;
}

export async function insertImportItemsBatchV2(
  db: Awaited<ReturnType<typeof ensureProductImportTablesV2>>,
  jobId: string,
  items: Array<{
    id: string;
    rowIndex: number;
    cityCode: string | null;
    productId: string | null;
    productJson: string;
    status: "pending" | "failed";
    error?: string | null;
  }>
): Promise<void> {
  if (items.length === 0) return;

  const ids = items.map((x) => x.id);
  const rowIndexes = items.map((x) => x.rowIndex);
  const cityCodes = items.map((x) => x.cityCode);
  const productIds = items.map((x) => x.productId);
  const productJsons = items.map((x) => x.productJson);
  const statuses = items.map((x) => x.status);
  const errors = items.map((x) => x.error ?? null);

  // UNNESTで1クエリinsert（バッチサイズは呼び出し元で制御）
  await db`
    insert into public.product_import_items_v2 (
      id, job_id, row_index, city_code, product_id, product_json, status, error
    )
    select
      x.id, ${jobId}, x.row_index, x.city_code, x.product_id, x.product_json, x.status, x.error
    from unnest(
      ${ids}::uuid[],
      ${rowIndexes}::int[],
      ${cityCodes}::text[],
      ${productIds}::text[],
      ${productJsons}::text[],
      ${statuses}::text[],
      ${errors}::text[]
    ) as x(
      id, row_index, city_code, product_id, product_json, status, error
    )
  `;
}

export async function createImportJobBaseV2(options: {
  totalCount: number;
  invalidCount: number;
  existingBehavior: ExistingProductBehavior;
  doTextEmbedding?: boolean;
  doImageCaptions?: boolean;
  doImageVectors?: boolean;
  captionImageInput?: CaptionImageInputMode;
  forcePending?: boolean;
}) {
  const db = await ensureProductImportTablesV2();
  const jobId = randomUUID();
  const totalCount = Math.max(0, Math.floor(options.totalCount));
  const invalidCount = Math.max(0, Math.floor(options.invalidCount));
  const processedCount = Math.min(totalCount, invalidCount);
  const failureCount = processedCount;
  const successCount = 0;
  const skippedCount = 0;
  const status = options.forcePending
    ? "pending"
    : processedCount >= totalCount
      ? "completed"
      : "pending";

  await db`
    insert into public.product_import_jobs_v2 (
      id,
      status,
      total_count,
      processed_count,
      success_count,
      failure_count,
      skipped_count,
      existing_behavior,
      do_text_embedding,
      do_image_captions,
      do_image_vectors,
      caption_image_input,
      started_at
    )
    values (
      ${jobId},
      ${status},
      ${totalCount},
      ${processedCount},
      ${successCount},
      ${failureCount},
      ${skippedCount},
      ${options.existingBehavior},
      ${options.doTextEmbedding ?? true},
      ${options.doImageCaptions ?? true},
      ${options.doImageVectors ?? true},
      ${options.captionImageInput ?? "url"},
      null
    )
  `;

  return jobId;
}

export async function appendImportItemsV2(options: {
  jobId: string;
  items: Array<{
    rowIndex: number;
    cityCode: string | null;
    productId: string | null;
    productJson: string;
    status: "pending" | "failed";
    error?: string | null;
  }>;
  updateJobCounts?: boolean;
}) {
  const db = await ensureProductImportTablesV2();
  const shouldUpdateJobCounts = options.updateJobCounts !== false;

  for (let offset = 0; offset < options.items.length; offset += INSERT_IMPORT_ITEMS_BATCH_SIZE) {
    const batch = options.items.slice(offset, offset + INSERT_IMPORT_ITEMS_BATCH_SIZE);
    const batchInvalidCount = batch.filter((item) => item.status === "failed").length;
    const batchWithIds = batch.map((item) => ({ id: randomUUID(), ...item }));
    await insertImportItemsBatchV2(db, options.jobId, batchWithIds);
    if (shouldUpdateJobCounts) {
      await db`
        update public.product_import_jobs_v2
        set total_count = total_count + ${batch.length},
            processed_count = processed_count + ${batchInvalidCount},
            failure_count = failure_count + ${batchInvalidCount},
            status = case
              when (total_count + ${batch.length}) <= (processed_count + ${batchInvalidCount})
                then 'completed'
              else 'pending'
            end,
            updated_at = now()
        where id = ${options.jobId}
      `;
    }
  }
}

export async function createImportJobV2(options: {
  items: Array<{
    rowIndex: number;
    cityCode: string | null;
    productId: string | null;
    productJson: string;
    status: "pending" | "failed";
    error?: string | null;
  }>;
  invalidCount: number;
  existingBehavior: ExistingProductBehavior;
  doTextEmbedding?: boolean;
  doImageCaptions?: boolean;
  doImageVectors?: boolean;
  captionImageInput?: CaptionImageInputMode;
}) {
  const jobId = await createImportJobBaseV2({
    totalCount: options.items.length,
    invalidCount: options.invalidCount,
    existingBehavior: options.existingBehavior,
    doTextEmbedding: options.doTextEmbedding,
    doImageCaptions: options.doImageCaptions,
    doImageVectors: options.doImageVectors,
    captionImageInput: options.captionImageInput,
  });

  await appendImportItemsV2({ jobId, items: options.items, updateJobCounts: false });
  return jobId;
}

export async function getImportJobV2(jobId: string): Promise<ImportJobV2 | null> {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    select
      id,
      status,
      total_count,
      processed_count,
      success_count,
      failure_count,
      skipped_count,
      existing_behavior,
      do_text_embedding,
      do_image_captions,
      do_image_vectors,
      caption_image_input,
      started_at,
      created_at,
      updated_at,
      completed_at
    from public.product_import_jobs_v2
    where id = ${jobId}
    limit 1
  `) as Array<{
    id: string;
    status: string;
    total_count: number;
    processed_count: number;
    success_count: number;
    failure_count: number;
    skipped_count: number;
    existing_behavior: ExistingProductBehavior;
    do_text_embedding: boolean;
    do_image_captions: boolean;
    do_image_vectors: boolean;
    caption_image_input: string | null;
    started_at: Date | null;
    created_at: Date;
    updated_at: Date;
    completed_at: Date | null;
  }>;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    totalCount: Number(row.total_count),
    processedCount: Number(row.processed_count),
    successCount: Number(row.success_count),
    failureCount: Number(row.failure_count),
    skippedCount: Number(row.skipped_count ?? 0),
    existingBehavior: row.existing_behavior ?? "skip",
    doTextEmbedding: Boolean(row.do_text_embedding ?? true),
    doImageCaptions: Boolean(row.do_image_captions ?? true),
    doImageVectors: Boolean(row.do_image_vectors ?? true),
    captionImageInput:
      row.caption_image_input === "data_url" ? "data_url" : "url",
    startedAt: (row.started_at ?? row.created_at).toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

export async function listImportJobsV2(limit: number) {
  const db = await ensureProductImportTablesV2();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = (await db`
    select
      id,
      status,
      total_count,
      processed_count,
      success_count,
      failure_count,
      skipped_count,
      existing_behavior,
      do_text_embedding,
      do_image_captions,
      do_image_vectors,
      caption_image_input,
      started_at,
      created_at,
      updated_at,
      completed_at
    from public.product_import_jobs_v2
    order by created_at desc
    limit ${safeLimit}
  `) as Array<{
    id: string;
    status: string;
    total_count: number;
    processed_count: number;
    success_count: number;
    failure_count: number;
    skipped_count: number;
    existing_behavior: ExistingProductBehavior;
    do_text_embedding: boolean;
    do_image_captions: boolean;
    do_image_vectors: boolean;
    caption_image_input: string | null;
    started_at: Date | null;
    created_at: Date;
    updated_at: Date;
    completed_at: Date | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    totalCount: Number(row.total_count),
    processedCount: Number(row.processed_count),
    successCount: Number(row.success_count),
    failureCount: Number(row.failure_count),
    skippedCount: Number(row.skipped_count ?? 0),
    existingBehavior: row.existing_behavior ?? "skip",
    doTextEmbedding: Boolean(row.do_text_embedding ?? true),
    doImageCaptions: Boolean(row.do_image_captions ?? true),
    doImageVectors: Boolean(row.do_image_vectors ?? true),
    captionImageInput:
      row.caption_image_input === "data_url" ? "data_url" : "url",
    startedAt: (row.started_at ?? row.created_at).toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  })) satisfies ImportJobSummaryV2[];
}

export async function getImportItemsPreviewV2(jobId: string, limit: number) {
  const db = await ensureProductImportTablesV2();
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = (await db`
    select
      row_index,
      city_code,
      product_id,
      status,
      error,
      substring(product_json, 1, 160) as product_json_preview
    from public.product_import_items_v2
    where job_id = ${jobId}
    order by row_index
    limit ${safeLimit}
  `) as Array<{
    row_index: number;
    city_code: string | null;
    product_id: string | null;
    status: string;
    error: string | null;
    product_json_preview: string | null;
  }>;
  return rows.map((row) => ({
    rowIndex: row.row_index,
    cityCode: row.city_code,
    productId: row.product_id,
    status: row.status,
    error: row.error,
    productJsonPreview: row.product_json_preview,
  }));
}

export async function deleteImportJobV2(jobId: string): Promise<boolean> {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    delete from public.product_import_jobs_v2
    where id = ${jobId}
    returning id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function updateImportJobFlagsV2(options: {
  jobId: string;
  existingBehavior?: ExistingProductBehavior;
  doTextEmbedding?: boolean;
  doImageCaptions?: boolean;
  doImageVectors?: boolean;
  captionImageInput?: CaptionImageInputMode;
}) {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    update public.product_import_jobs_v2
    set existing_behavior = coalesce(${options.existingBehavior ?? null}, existing_behavior),
        do_text_embedding = coalesce(${options.doTextEmbedding ?? null}, do_text_embedding),
        do_image_captions = coalesce(${options.doImageCaptions ?? null}, do_image_captions),
        do_image_vectors = coalesce(${options.doImageVectors ?? null}, do_image_vectors),
        caption_image_input = coalesce(${options.captionImageInput ?? null}, caption_image_input),
        updated_at = now()
    where id = ${options.jobId}
    returning id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function deleteDownstreamForJobV2(options: { jobId: string }) {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    select distinct product_id
    from public.product_import_items_v2
    where job_id = ${options.jobId}
      and product_id is not null
  `) as Array<{ product_id: string }>;
  const productIds = rows.map((row) => row.product_id).filter((id) => id);
  if (productIds.length === 0) {
    return { productIds: 0, deletedText: 0, deletedImages: 0 };
  }

  await ensureProductTextEmbeddingsInitialized();
  await ensureProductImagesVectorizeInitialized();

  let deletedText = 0;
  let deletedImages = 0;
  for (let offset = 0; offset < productIds.length; offset += DOWNSTREAM_DELETE_BATCH_SIZE) {
    const batch = productIds.slice(offset, offset + DOWNSTREAM_DELETE_BATCH_SIZE);
    const textRows = (await db`
      delete from product_text_embeddings
      where product_id = any(${batch}::text[])
      returning id
    `) as Array<{ id: string }>;
    deletedText += textRows.length;

    const imageRows = (await db`
      delete from public.product_images_vectorize
      where product_id = any(${batch}::text[])
      returning id
    `) as Array<{ id: string }>;
    deletedImages += imageRows.length;
  }

  return { productIds: productIds.length, deletedText, deletedImages };
}

export async function requeueImportItemsV2(options: {
  jobId: string;
  statuses: Array<"failed" | "skipped" | "success">;
}) {
  const db = await ensureProductImportTablesV2();
  const uniqueStatuses = Array.from(new Set(options.statuses));
  if (uniqueStatuses.length === 0) {
    return { requeuedCount: 0, successCount: 0, failedCount: 0, skippedCount: 0 };
  }

  const rows = (await db`
    with target as (
      select id, status
      from public.product_import_items_v2
      where job_id = ${options.jobId}
        and status = any(${uniqueStatuses}::text[])
    ),
    updated as (
      update public.product_import_items_v2 as items
      set status = 'pending',
          error = null,
          error_code = null,
          next_retry_at = null,
          processing_started_at = null,
          current_step = null,
          current_step_detail = null,
          updated_at = now()
      from target
      where items.id = target.id
      returning target.status as prev_status
    )
    select prev_status
    from updated
  `) as Array<{ prev_status: string }>;

  const requeuedCount = rows.length;
  if (requeuedCount === 0) {
    return { requeuedCount: 0, successCount: 0, failedCount: 0, skippedCount: 0 };
  }

  const successCount = rows.filter((row) => row.prev_status === "success").length;
  const failedCount = rows.filter((row) => row.prev_status === "failed").length;
  const skippedCount = rows.filter((row) => row.prev_status === "skipped").length;

  await db`
    update public.product_import_jobs_v2
    set processed_count = greatest(processed_count - ${requeuedCount}, 0),
        success_count = greatest(success_count - ${successCount}, 0),
        failure_count = greatest(failure_count - ${failedCount}, 0),
        skipped_count = greatest(skipped_count - ${skippedCount}, 0),
        started_at = null,
        status = case
          when greatest(processed_count - ${requeuedCount}, 0) >= total_count
            then 'completed'
          else 'pending'
        end,
        completed_at = case
          when greatest(processed_count - ${requeuedCount}, 0) >= total_count
            then completed_at
          else null
        end,
        updated_at = now()
    where id = ${options.jobId}
  `;

  return { requeuedCount, successCount, failedCount, skippedCount };
}

export async function markJobStartedV2(jobId: string) {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    update public.product_import_jobs_v2
    set status = case
          when status = 'pending' then 'running'
          else status
        end,
        started_at = case
          when status = 'pending' then coalesce(started_at, now())
          else started_at
        end,
        updated_at = now()
    where id = ${jobId}
    returning id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function getFailedItemsV2(jobId: string, limit: number) {
  const db = await ensureProductImportTablesV2();
  return (await db`
    select row_index, product_id, city_code, error
    from public.product_import_items_v2
    where job_id = ${jobId} and status = 'failed'
    order by row_index desc
    limit ${limit}
  `) as Array<{
    row_index: number;
    product_id: string | null;
    city_code: string | null;
    error: string | null;
  }>;
}

export async function getProcessingItemsV2(jobId: string, limit: number) {
  const db = await ensureProductImportTablesV2();
  return (await db`
    select
      row_index,
      product_id,
      city_code,
      updated_at,
      attempt_count,
      processing_started_at,
      current_step,
      current_step_detail,
      error_code,
      next_retry_at
    from public.product_import_items_v2
    where job_id = ${jobId} and status = 'processing'
    order by updated_at desc
    limit ${limit}
  `) as Array<{
    row_index: number;
    product_id: string | null;
    city_code: string | null;
    updated_at: Date;
    attempt_count: number;
    processing_started_at: Date | null;
    current_step: string | null;
    current_step_detail: string | null;
    error_code: string | null;
    next_retry_at: Date | null;
  }>;
}

export async function updateItemStepV2(options: {
  itemId: string;
  step: string;
  detail?: string | null;
}) {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_items_v2
    set current_step = ${options.step},
        current_step_detail = ${options.detail ?? null},
        updated_at = now()
    where id = ${options.itemId}
  `;
}

export async function enqueueVectorizeTailItems(options: {
  jobId: string;
  importItemId: string;
  productId: string;
  cityCode: string | null;
  items: Array<{ imageUrl: string; slideIndex: number }>;
}): Promise<number> {
  const db = await ensureProductImportTablesV2();
  const normalizedItems = options.items
    .map((item) => ({
      imageUrl: item.imageUrl.trim(),
      slideIndex: Math.floor(item.slideIndex),
    }))
    .filter(
      (item) =>
        item.imageUrl.length > 0 &&
        Number.isFinite(item.slideIndex) &&
        item.slideIndex >= 0
    );

  if (normalizedItems.length === 0) {
    await db`
      delete from public.product_import_vectorize_tail_items
      where import_item_id = ${options.importItemId}
    `;
    return 0;
  }

  const ids = normalizedItems.map(() => randomUUID());
  const imageUrls = normalizedItems.map((item) => item.imageUrl);
  const slideIndexes = normalizedItems.map((item) => item.slideIndex);

  await db`
    delete from public.product_import_vectorize_tail_items
    where import_item_id = ${options.importItemId}
      and not (slide_index = any(${slideIndexes}::int[]))
  `;

  const rows = (await db`
    insert into public.product_import_vectorize_tail_items (
      id,
      job_id,
      import_item_id,
      product_id,
      city_code,
      image_url,
      slide_index,
      status
    )
    select
      x.id,
      ${options.jobId},
      ${options.importItemId},
      ${options.productId},
      ${options.cityCode},
      x.image_url,
      x.slide_index,
      'pending'
    from unnest(
      ${ids}::uuid[],
      ${imageUrls}::text[],
      ${slideIndexes}::int[]
    ) as x(id, image_url, slide_index)
    on conflict (import_item_id, slide_index) do update
    set job_id = excluded.job_id,
        product_id = excluded.product_id,
        city_code = excluded.city_code,
        image_url = excluded.image_url,
        status = 'pending',
        error = null,
        error_code = null,
        next_retry_at = null,
        processing_started_at = null,
        updated_at = now()
    returning id
  `) as Array<{ id: string }>;

  return rows.length;
}

export async function getVectorizeTailStats(
  jobId: string
): Promise<VectorizeTailStats> {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    select
      count(*) filter (where status = 'pending') as pending_count,
      count(*) filter (where status = 'processing') as processing_count,
      count(*) filter (where status = 'success') as success_count,
      count(*) filter (where status = 'failed') as failed_count,
      min(next_retry_at) filter (
        where status = 'pending'
          and next_retry_at > now()
      ) as next_retry_at
    from public.product_import_vectorize_tail_items
    where job_id = ${jobId}
  `) as Array<{
    pending_count: number;
    processing_count: number;
    success_count: number;
    failed_count: number;
    next_retry_at: Date | null;
  }>;

  const row = rows[0];
  return {
    pendingCount: Number(row?.pending_count ?? 0),
    processingCount: Number(row?.processing_count ?? 0),
    successCount: Number(row?.success_count ?? 0),
    failedCount: Number(row?.failed_count ?? 0),
    nextRetryAt: row?.next_retry_at ? row.next_retry_at.toISOString() : null,
  };
}

export async function claimPendingVectorizeTailItems(options: {
  jobId: string;
  limit: number;
}): Promise<VectorizeTailItem[]> {
  const db = await ensureProductImportTablesV2();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(options.limit)));
  const pickedIds = (await db`
    select id
    from public.product_import_vectorize_tail_items
    where job_id = ${options.jobId}
      and status = 'pending'
      and (next_retry_at is null or next_retry_at <= now())
    order by slide_index, created_at
    limit ${safeLimit}
  `) as Array<{ id: string }>;

  if (pickedIds.length === 0) {
    return [];
  }

  const ids = pickedIds.map((row) => row.id);
  const rows = (await db`
    update public.product_import_vectorize_tail_items
    set status = 'processing',
        attempt_count = attempt_count + 1,
        processing_started_at = now(),
        updated_at = now()
    where job_id = ${options.jobId}
      and status = 'pending'
      and id = any(${ids}::uuid[])
    returning
      id,
      job_id,
      import_item_id,
      product_id,
      city_code,
      image_url,
      slide_index,
      status,
      attempt_count,
      next_retry_at,
      error,
      error_code,
      processing_started_at,
      created_at,
      updated_at
  `) as Array<{
    id: string;
    job_id: string;
    import_item_id: string;
    product_id: string;
    city_code: string | null;
    image_url: string;
    slide_index: number;
    status: "processing";
    attempt_count: number;
    next_retry_at: Date | null;
    error: string | null;
    error_code: string | null;
    processing_started_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>;

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    importItemId: row.import_item_id,
    productId: row.product_id,
    cityCode: row.city_code,
    imageUrl: row.image_url,
    slideIndex: Number(row.slide_index),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextRetryAt: row.next_retry_at ? row.next_retry_at.toISOString() : null,
    error: row.error,
    errorCode: row.error_code,
    processingStartedAt: row.processing_started_at
      ? row.processing_started_at.toISOString()
      : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function requeueStaleVectorizeTailItems(options: {
  jobId: string;
  staleSeconds: number;
}): Promise<number> {
  const db = await ensureProductImportTablesV2();
  const staleSeconds = Math.max(30, Math.min(24 * 60 * 60, Math.floor(options.staleSeconds)));
  const rows = (await db`
    update public.product_import_vectorize_tail_items
    set status = 'pending',
        error = ${"stale processing item requeued"},
        error_code = ${"stale_processing"},
        next_retry_at = null,
        processing_started_at = null,
        attempt_count = greatest(attempt_count - 1, 0),
        updated_at = now()
    where job_id = ${options.jobId}
      and status = 'processing'
      and updated_at < now() - (${staleSeconds}::int * interval '1 second')
    returning id
  `) as Array<{ id: string }>;
  return rows.length;
}

export async function markVectorizeTailItemSuccess(id: string): Promise<void> {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_vectorize_tail_items
    set status = 'success',
        error = null,
        error_code = null,
        next_retry_at = null,
        processing_started_at = null,
        updated_at = now()
    where id = ${id}
  `;
}

export async function markVectorizeTailItemFailure(options: {
  id: string;
  retryable: boolean;
  error: string;
  errorCode: string;
  retryAfterSeconds?: number;
}): Promise<void> {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_vectorize_tail_items
    set status = ${options.retryable ? "pending" : "failed"},
        error = ${options.error},
        error_code = ${options.errorCode},
        next_retry_at = ${
          options.retryable
            ? new Date(Date.now() + Math.max(1, options.retryAfterSeconds ?? 1) * 1000)
            : null
        },
        processing_started_at = null,
        updated_at = now()
    where id = ${options.id}
  `;
}

export async function checkExistingVectorizationComplete(options: {
  productId: string;
  expectedSlideIndexes: number[];
}): Promise<boolean> {
  const expectedSlideIndexes = Array.from(
    new Set(
      options.expectedSlideIndexes
        .map((slideIndex) => Math.floor(slideIndex))
        .filter((slideIndex) => Number.isFinite(slideIndex) && slideIndex >= 0)
    )
  );

  if (expectedSlideIndexes.length === 0) {
    return true;
  }

  const actualSlideIndexes = await getVectorizedSlideIndexes(options.productId);
  for (const slideIndex of expectedSlideIndexes) {
    if (!actualSlideIndexes.has(slideIndex)) {
      return false;
    }
  }

  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    select 1
    from public.product_import_vectorize_tail_items
    where product_id = ${options.productId}
      and slide_index = any(${expectedSlideIndexes}::int[])
      and status in ('pending', 'processing', 'failed')
    limit 1
  `) as Array<Record<string, unknown>>;

  return rows.length === 0;
}

export async function getQueueStatsV2(jobId: string): Promise<ImportQueueStatsV2> {
  const db = await ensureProductImportTablesV2();
  const rows = (await db`
    select
      count(*) filter (
        where status = 'pending'
          and (next_retry_at is null or next_retry_at <= now())
      ) as pending_ready_count,
      count(*) filter (
        where status = 'pending'
          and next_retry_at > now()
      ) as pending_delayed_count,
      count(*) filter (where status = 'processing') as processing_count,
      count(*) filter (where status = 'success') as success_count,
      count(*) filter (where status = 'failed') as failed_count,
      count(*) filter (where status = 'skipped') as skipped_count,
      min(next_retry_at) filter (
        where status = 'pending'
          and next_retry_at > now()
      ) as next_retry_at
    from public.product_import_items_v2
    where job_id = ${jobId}
  `) as Array<{
    pending_ready_count: number;
    pending_delayed_count: number;
    processing_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    next_retry_at: Date | null;
  }>;

  const row = rows[0];
  return {
    pendingReadyCount: Number(row?.pending_ready_count ?? 0),
    pendingDelayedCount: Number(row?.pending_delayed_count ?? 0),
    processingCount: Number(row?.processing_count ?? 0),
    successCount: Number(row?.success_count ?? 0),
    failedCount: Number(row?.failed_count ?? 0),
    skippedCount: Number(row?.skipped_count ?? 0),
    nextRetryAt: row?.next_retry_at ? row.next_retry_at.toISOString() : null,
  };
}

export async function claimPendingItemsV2(jobId: string, limit: number) {
  const db = await ensureProductImportTablesV2();
  // 2段階でIDを拾ってから更新（特定環境でUPDATE/CTEが0件になる問題の回避）
  const pickedIds = (await db`
    select id
    from public.product_import_items_v2
    where job_id = ${jobId}
      and status = 'pending'
      and (next_retry_at is null or next_retry_at <= now())
    order by row_index
    limit ${limit}
  `) as Array<{ id: string }>;

  if (pickedIds.length === 0) return [];

  const idList = pickedIds.map((row) => row.id);
  return (await db`
    update public.product_import_items_v2
    set status = 'processing',
        attempt_count = attempt_count + 1,
        processing_started_at = now(),
        updated_at = now()
    where job_id = ${jobId}
      and status = 'pending'
      and id = any(${idList}::uuid[])
    returning id, row_index, city_code, product_id, product_json, attempt_count
  `) as Array<{
    id: string;
    row_index: number;
    city_code: string | null;
    product_id: string | null;
    product_json: string;
    attempt_count: number;
  }>;
}

export async function requeueStaleProcessingItemsV2(options: {
  jobId: string;
  staleSeconds: number;
}): Promise<number> {
  const db = await ensureProductImportTablesV2();
  const staleSeconds = Math.max(30, Math.min(24 * 60 * 60, Math.floor(options.staleSeconds)));
  const rows = (await db`
    update public.product_import_items_v2
    set status = 'pending',
        error = ${"stale processing item requeued"},
        error_code = ${"stale_processing"},
        next_retry_at = null,
        processing_started_at = null,
        current_step = 'stale_requeued',
        current_step_detail = null,
        attempt_count = greatest(attempt_count - 1, 0),
        updated_at = now()
    where job_id = ${options.jobId}
      and status = 'processing'
      and updated_at < now() - (${staleSeconds}::int * interval '1 second')
    returning id
  `) as Array<{ id: string }>;
  return rows.length;
}

export async function releaseClaimedItemsV2(options: {
  jobId: string;
  itemIds: string[];
}) {
  if (options.itemIds.length === 0) return;
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_items_v2
    set status = 'pending',
        error = null,
        error_code = null,
        next_retry_at = null,
        processing_started_at = null,
        current_step = null,
        current_step_detail = null,
        attempt_count = greatest(attempt_count - 1, 0),
        updated_at = now()
    where job_id = ${options.jobId}
      and status = 'processing'
      and id = any(${options.itemIds}::uuid[])
  `;
}

export async function markItemSuccessV2(options: { itemId: string; jobId: string }) {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_items_v2
    set status = 'success',
        error = null,
        error_code = null,
        next_retry_at = null,
        current_step = 'success',
        current_step_detail = null,
        updated_at = now()
    where id = ${options.itemId}
  `;
  await db`
    update public.product_import_jobs_v2
    set processed_count = processed_count + 1,
        success_count = success_count + 1,
        updated_at = now()
    where id = ${options.jobId}
  `;
}

export async function markItemFailureV2(options: {
  itemId: string;
  jobId: string;
  error: string;
  errorCode?: string | null;
}) {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_items_v2
    set status = 'failed',
        error = ${options.error},
        error_code = ${options.errorCode ?? null},
        next_retry_at = null,
        current_step = 'failed',
        current_step_detail = null,
        updated_at = now()
    where id = ${options.itemId}
  `;
  await db`
    update public.product_import_jobs_v2
    set processed_count = processed_count + 1,
        failure_count = failure_count + 1,
        updated_at = now()
    where id = ${options.jobId}
  `;
}

export async function markItemSkippedV2(options: { itemId: string; jobId: string }) {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_items_v2
    set status = 'skipped',
        error = null,
        error_code = null,
        next_retry_at = null,
        current_step = 'skipped',
        current_step_detail = null,
        updated_at = now()
    where id = ${options.itemId}
  `;
  await db`
    update public.product_import_jobs_v2
    set processed_count = processed_count + 1,
        skipped_count = skipped_count + 1,
        updated_at = now()
    where id = ${options.jobId}
  `;
}

export async function markItemsSkippedBulkV2(options: {
  jobId: string;
  itemIds: string[];
}): Promise<number> {
  if (options.itemIds.length === 0) return 0;
  const db = await ensureProductImportTablesV2();

  const rows = (await db`
    update public.product_import_items_v2
    set status = 'skipped',
        error = null,
        error_code = null,
        next_retry_at = null,
        current_step = 'skipped',
        current_step_detail = null,
        updated_at = now()
    where job_id = ${options.jobId}
      and status = 'processing'
      and id = any(${options.itemIds}::uuid[])
    returning id
  `) as Array<{ id: string }>;

  const count = rows.length;
  if (count > 0) {
    await db`
      update public.product_import_jobs_v2
      set processed_count = processed_count + ${count},
          skipped_count = skipped_count + ${count},
          updated_at = now()
      where id = ${options.jobId}
    `;
  }
  return count;
}

export async function markItemRetryV2(options: {
  itemId: string;
  jobId: string;
  error: string;
  errorCode: string;
  retryAfterSeconds: number;
}) {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_items_v2
    set status = 'pending',
        error = ${options.error},
        error_code = ${options.errorCode},
        next_retry_at = now() + (${options.retryAfterSeconds}::int * interval '1 second'),
        processing_started_at = null,
        current_step = 'retry_wait',
        current_step_detail = null,
        updated_at = now()
    where id = ${options.itemId}
  `;
}

export async function updateJobStatusV2(jobId: string) {
  const db = await ensureProductImportTablesV2();
  await db`
    update public.product_import_jobs_v2
    set status = case
      when processed_count >= total_count then 'completed'
      when status = 'pending' then 'running'
      else status
    end,
    started_at = case
      when status = 'pending' then coalesce(started_at, now())
      else started_at
    end,
    completed_at = case
      when processed_count >= total_count then coalesce(completed_at, now())
      else completed_at
    end,
    updated_at = now()
    where id = ${jobId}
  `;
}
