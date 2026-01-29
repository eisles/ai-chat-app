import { getDb } from "@/lib/neon";
import { randomUUID } from "crypto";

export type ImportJob = {
  id: string;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ImportItem = {
  id: string;
  rowIndex: number;
  cityCode: string | null;
  productId: string | null;
  productJson: string;
};

export async function ensureProductImportTables() {
  const db = getDb();
  await db`
    create table if not exists public.product_import_jobs (
      id uuid primary key,
      status text not null,
      total_count integer not null,
      processed_count integer not null,
      success_count integer not null,
      failure_count integer not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      completed_at timestamptz
    );
  `;
  await db`
    alter table public.product_import_jobs
    add column if not exists completed_at timestamptz
  `;
  await db`
    create table if not exists public.product_import_items (
      id uuid primary key,
      job_id uuid not null references public.product_import_jobs(id) on delete cascade,
      row_index integer not null,
      city_code text,
      product_id text,
      product_json text not null,
      status text not null,
      error text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `;
  await db`
    create index if not exists product_import_items_job_status_idx
      on public.product_import_items(job_id, status, row_index)
  `;
  return db;
}

export async function createImportJob(options: {
  items: Array<{
    rowIndex: number;
    cityCode: string | null;
    productId: string | null;
    productJson: string;
    status: "pending" | "failed";
    error?: string | null;
  }>;
  invalidCount: number;
}) {
  const db = await ensureProductImportTables();
  const jobId = randomUUID();
  const totalCount = options.items.length;
  const processedCount = options.invalidCount;
  const failureCount = options.invalidCount;
  const successCount = 0;
  const status = processedCount >= totalCount ? "completed" : "pending";

  await db`
    insert into public.product_import_jobs (
      id,
      status,
      total_count,
      processed_count,
      success_count,
      failure_count
    )
    values (
      ${jobId},
      ${status},
      ${totalCount},
      ${processedCount},
      ${successCount},
      ${failureCount}
    )
  `;

  for (const item of options.items) {
    const itemId = randomUUID();
    await db`
      insert into public.product_import_items (
        id,
        job_id,
        row_index,
        city_code,
        product_id,
        product_json,
        status,
        error
      )
      values (
        ${itemId},
        ${jobId},
        ${item.rowIndex},
        ${item.cityCode},
        ${item.productId},
        ${item.productJson},
        ${item.status},
        ${item.error ?? null}
      )
    `;
  }

  return jobId;
}

export async function getImportJob(jobId: string): Promise<ImportJob | null> {
  const db = await ensureProductImportTables();
  const rows = (await db`
    select
      id,
      status,
      total_count,
      processed_count,
      success_count,
      failure_count,
      created_at,
      updated_at,
      completed_at
    from public.product_import_jobs
    where id = ${jobId}
    limit 1
  `) as Array<{
    id: string;
    status: string;
    total_count: number;
    processed_count: number;
    success_count: number;
    failure_count: number;
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

export async function getFailedItems(jobId: string, limit: number) {
  const db = await ensureProductImportTables();
  return (await db`
    select row_index, product_id, city_code, error
    from public.product_import_items
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

export async function getProcessingItems(jobId: string, limit: number) {
  const db = await ensureProductImportTables();
  return (await db`
    select row_index, product_id, city_code, updated_at
    from public.product_import_items
    where job_id = ${jobId} and status = 'processing'
    order by updated_at desc
    limit ${limit}
  `) as Array<{
    row_index: number;
    product_id: string | null;
    city_code: string | null;
    updated_at: Date;
  }>;
}

export async function claimPendingItems(jobId: string, limit: number) {
  const db = await ensureProductImportTables();
  return (await db`
    update public.product_import_items
    set status = 'processing', updated_at = now()
    where id in (
      select id
      from public.product_import_items
      where job_id = ${jobId} and status = 'pending'
      order by row_index
      limit ${limit}
      for update skip locked
    )
    returning id, row_index, city_code, product_id, product_json
  `) as Array<{
    id: string;
    row_index: number;
    city_code: string | null;
    product_id: string | null;
    product_json: string;
  }>;
}

export async function markItemSuccess(options: {
  itemId: string;
  jobId: string;
}) {
  const db = await ensureProductImportTables();
  await db`
    update public.product_import_items
    set status = 'success', error = null, updated_at = now()
    where id = ${options.itemId}
  `;
  await db`
    update public.product_import_jobs
    set processed_count = processed_count + 1,
        success_count = success_count + 1,
        updated_at = now()
    where id = ${options.jobId}
  `;
}

export async function markItemFailure(options: {
  itemId: string;
  jobId: string;
  error: string;
}) {
  const db = await ensureProductImportTables();
  await db`
    update public.product_import_items
    set status = 'failed', error = ${options.error}, updated_at = now()
    where id = ${options.itemId}
  `;
  await db`
    update public.product_import_jobs
    set processed_count = processed_count + 1,
        failure_count = failure_count + 1,
        updated_at = now()
    where id = ${options.jobId}
  `;
}

export async function updateJobStatus(jobId: string) {
  const db = await ensureProductImportTables();
  await db`
    update public.product_import_jobs
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
