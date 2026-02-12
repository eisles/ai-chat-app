import { getDb } from "@/lib/neon";
import type { ExistingProductBehavior } from "@/lib/product-import-behavior";
import { randomUUID } from "crypto";

export const INSERT_IMPORT_ITEMS_BATCH_SIZE = 1000;

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

export async function ensureProductImportTablesV2() {
  const db = getDb();
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
}) {
  const db = await ensureProductImportTablesV2();
  const jobId = randomUUID();
  const totalCount = Math.max(0, Math.floor(options.totalCount));
  const invalidCount = Math.max(0, Math.floor(options.invalidCount));
  const processedCount = Math.min(totalCount, invalidCount);
  const failureCount = processedCount;
  const successCount = 0;
  const skippedCount = 0;
  const status = processedCount >= totalCount ? "completed" : "pending";

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
      caption_image_input
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
      ${options.captionImageInput ?? "url"}
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
}) {
  const db = await ensureProductImportTablesV2();

  for (let offset = 0; offset < options.items.length; offset += INSERT_IMPORT_ITEMS_BATCH_SIZE) {
    const batch = options.items.slice(offset, offset + INSERT_IMPORT_ITEMS_BATCH_SIZE);
    const batchWithIds = batch.map((item) => ({ id: randomUUID(), ...item }));
    await insertImportItemsBatchV2(db, options.jobId, batchWithIds);
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

  await appendImportItemsV2({ jobId, items: options.items });
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
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
  return (await db`
    update public.product_import_items_v2
    set status = 'processing',
        attempt_count = attempt_count + 1,
        updated_at = now()
    where id in (
      select id
      from public.product_import_items_v2
      where job_id = ${jobId}
        and status = 'pending'
        and (next_retry_at is null or next_retry_at <= now())
      order by row_index
      limit ${limit}
      for update skip locked
    )
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
    completed_at = case
      when processed_count >= total_count then coalesce(completed_at, now())
      else completed_at
    end,
    updated_at = now()
    where id = ${jobId}
  `;
}
