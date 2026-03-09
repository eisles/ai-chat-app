import { neon } from "@neondatabase/serverless";
import { getDb } from "@/lib/neon";

export type VectorMaintenanceAction =
  | "analyze_tables"
  | "rebuild_hnsw_index"
  | "repair_product_slide_unique_index";

export type VectorMaintenanceIndexStatus = {
  indexName: string;
  isValid: boolean;
  isReady: boolean;
  sizePretty: string | null;
  indexDef: string;
};

export type VectorMaintenanceTableStats = {
  tableName: string;
  liveRows: number;
  deadRows: number;
  lastAnalyze: string | null;
  lastAutoAnalyze: string | null;
};

export type VectorMaintenanceProgress = {
  processId: number;
  phase: string;
  blocksTotal: number;
  blocksDone: number;
  tuplesDone: number;
};

export type VectorMaintenanceState = {
  checkedAt: string;
  summary: {
    totalRows: number;
    distinctProducts: number;
    imageUrlRows: number;
    embeddedRows: number;
    duplicateGroups: number;
    duplicateRows: number;
  };
  tables: VectorMaintenanceTableStats[];
  indexes: VectorMaintenanceIndexStatus[];
  activeRebuilds: VectorMaintenanceProgress[];
};

export type VectorMaintenanceActionResult = {
  ok: true;
  action: VectorMaintenanceAction;
  message: string;
  executedAt: string;
};

const MAINTENANCE_INDEX_NAMES = [
  "product_images_vectorize_embedding_hnsw_idx",
  "product_images_vectorize_product_slide_uidx",
  "product_images_vectorize_image_url_idx",
  "product_text_embeddings_product_json_latest_idx",
] as const;

const VALID_ACTIONS: VectorMaintenanceAction[] = [
  "analyze_tables",
  "rebuild_hnsw_index",
  "repair_product_slide_unique_index",
];

const HNSW_INDEX_SQL = `
CREATE INDEX CONCURRENTLY product_images_vectorize_embedding_hnsw_idx
  ON public.product_images_vectorize
  USING hnsw (embedding vector_l2_ops)
  WITH (m = 16, ef_construction = 64)
`;

const PRODUCT_SLIDE_DEDUPE_SQL = `
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY product_id, slide_index
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM public.product_images_vectorize
)
DELETE FROM public.product_images_vectorize
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE row_num > 1
)
`;

const PRODUCT_SLIDE_UNIQUE_SQL = `
CREATE UNIQUE INDEX CONCURRENTLY product_images_vectorize_product_slide_uidx
  ON public.product_images_vectorize (product_id, slide_index)
`;

function getMaintenanceConnectionString(): string {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error(
      "Missing maintenance connection string. Set DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING, NEON_DATABASE_URL, DATABASE_URL, or POSTGRES_URL."
    );
  }

  return connectionString;
}

function getMaintenanceDb() {
  return neon(getMaintenanceConnectionString());
}

export function isVectorMaintenanceAction(
  value: unknown
): value is VectorMaintenanceAction {
  return (
    typeof value === "string" &&
    VALID_ACTIONS.includes(value as VectorMaintenanceAction)
  );
}

async function getDuplicateSummary() {
  const db = getDb();
  const rows = (await db`
    select
      count(*)::int as duplicate_groups,
      coalesce(sum(cnt - 1), 0)::int as duplicate_rows
    from (
      select count(*)::int as cnt
      from public.product_images_vectorize
      group by product_id, slide_index
      having count(*) > 1
    ) duplicates
  `) as Array<{
    duplicate_groups: number | null;
    duplicate_rows: number | null;
  }>;

  return {
    duplicateGroups: rows[0]?.duplicate_groups ?? 0,
    duplicateRows: rows[0]?.duplicate_rows ?? 0,
  };
}

export async function getVectorMaintenanceState(): Promise<VectorMaintenanceState> {
  const db = getDb();

  const summaryRows = (await db`
    select
      count(*)::int as total_rows,
      count(distinct product_id)::int as distinct_products,
      count(*) filter (where image_url is not null)::int as image_url_rows,
      count(*) filter (where embedding is not null)::int as embedded_rows
    from public.product_images_vectorize
  `) as Array<{
    total_rows: number;
    distinct_products: number;
    image_url_rows: number;
    embedded_rows: number;
  }>;

  const tableRows = (await db`
    select
      relname as table_name,
      coalesce(n_live_tup, 0)::int as live_rows,
      coalesce(n_dead_tup, 0)::int as dead_rows,
      last_analyze,
      last_autoanalyze
    from pg_stat_user_tables
    where schemaname = 'public'
      and relname in ('product_images_vectorize', 'product_text_embeddings')
    order by relname
  `) as Array<{
    table_name: string;
    live_rows: number;
    dead_rows: number;
    last_analyze: Date | null;
    last_autoanalyze: Date | null;
  }>;

  const indexRows = (await db`
    select
      c.relname as index_name,
      i.indisvalid as is_valid,
      i.indisready as is_ready,
      pg_size_pretty(pg_relation_size(c.oid)) as size_pretty,
      pg_get_indexdef(i.indexrelid) as index_def
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.relname = any(${Array.from(MAINTENANCE_INDEX_NAMES)}::text[])
    order by c.relname
  `) as Array<{
    index_name: string;
    is_valid: boolean;
    is_ready: boolean;
    size_pretty: string | null;
    index_def: string;
  }>;

  const progressRows = (await db`
    select
      pid::int as process_id,
      phase,
      coalesce(blocks_total, 0)::int as blocks_total,
      coalesce(blocks_done, 0)::int as blocks_done,
      coalesce(tuples_done, 0)::int as tuples_done
    from pg_stat_progress_create_index
    where relid = 'public.product_images_vectorize'::regclass
    order by pid
  `) as Array<{
    process_id: number;
    phase: string;
    blocks_total: number;
    blocks_done: number;
    tuples_done: number;
  }>;

  const duplicates = await getDuplicateSummary();

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      totalRows: summaryRows[0]?.total_rows ?? 0,
      distinctProducts: summaryRows[0]?.distinct_products ?? 0,
      imageUrlRows: summaryRows[0]?.image_url_rows ?? 0,
      embeddedRows: summaryRows[0]?.embedded_rows ?? 0,
      duplicateGroups: duplicates.duplicateGroups,
      duplicateRows: duplicates.duplicateRows,
    },
    tables: tableRows.map((row) => ({
      tableName: row.table_name,
      liveRows: row.live_rows,
      deadRows: row.dead_rows,
      lastAnalyze: row.last_analyze?.toISOString() ?? null,
      lastAutoAnalyze: row.last_autoanalyze?.toISOString() ?? null,
    })),
    indexes: indexRows.map((row) => ({
      indexName: row.index_name,
      isValid: row.is_valid,
      isReady: row.is_ready,
      sizePretty: row.size_pretty,
      indexDef: row.index_def,
    })),
    activeRebuilds: progressRows.map((row) => ({
      processId: row.process_id,
      phase: row.phase,
      blocksTotal: row.blocks_total,
      blocksDone: row.blocks_done,
      tuplesDone: row.tuples_done,
    })),
  };
}

async function analyzeTables() {
  const db = getMaintenanceDb();
  await db.query("ANALYZE public.product_images_vectorize");
  await db.query("ANALYZE public.product_text_embeddings");
}

async function rebuildHnswIndex() {
  const db = getMaintenanceDb();
  await db.query(
    "DROP INDEX CONCURRENTLY IF EXISTS public.product_images_vectorize_embedding_hnsw_idx"
  );
  await db.query(HNSW_INDEX_SQL);
  await db.query("ANALYZE public.product_images_vectorize");
}

async function repairProductSlideUniqueIndex() {
  const db = getMaintenanceDb();
  await db.query(PRODUCT_SLIDE_DEDUPE_SQL);
  await db.query(
    "DROP INDEX CONCURRENTLY IF EXISTS public.product_images_vectorize_product_slide_uidx"
  );
  await db.query(PRODUCT_SLIDE_UNIQUE_SQL);
  await db.query("ANALYZE public.product_images_vectorize");
}

export async function runVectorMaintenanceAction(
  action: VectorMaintenanceAction
): Promise<VectorMaintenanceActionResult> {
  if (action === "analyze_tables") {
    await analyzeTables();
    return {
      ok: true,
      action,
      message: "ANALYZE を実行しました。",
      executedAt: new Date().toISOString(),
    };
  }

  if (action === "rebuild_hnsw_index") {
    await rebuildHnswIndex();
    return {
      ok: true,
      action,
      message:
        "HNSW index を再構築し、product_images_vectorize を ANALYZE しました。",
      executedAt: new Date().toISOString(),
    };
  }

  await repairProductSlideUniqueIndex();
  return {
    ok: true,
    action,
    message:
      "重複行を整理したうえで (product_id, slide_index) unique index を再構築しました。",
    executedAt: new Date().toISOString(),
  };
}
