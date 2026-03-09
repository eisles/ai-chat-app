import { neon } from "@neondatabase/serverless";

import {
  listMaintenanceActionLogs,
  type MaintenanceActionLog,
} from "@/lib/maintenance-action-log";
import { getDb } from "@/lib/neon";
import { refreshRecommendCategoryCandidatesCache } from "@/lib/recommend/category-candidates";

export type TextEmbeddingsMaintenanceAction =
  | "analyze_table"
  | "rebuild_hnsw_index"
  | "repair_amount_index"
  | "refresh_category_candidates_cache";

export type TextEmbeddingsMaintenanceIndexStatus = {
  indexName: string;
  isValid: boolean;
  isReady: boolean;
  sizePretty: string | null;
  indexDef: string;
};

export type TextEmbeddingsMaintenanceTableStats = {
  tableName: string;
  liveRows: number;
  deadRows: number;
  lastAnalyze: string | null;
  lastAutoAnalyze: string | null;
};

export type TextEmbeddingsMaintenanceProgress = {
  processId: number;
  phase: string;
  blocksTotal: number;
  blocksDone: number;
  tuplesDone: number;
};

export type TextEmbeddingsMaintenanceState = {
  checkedAt: string;
  summary: {
    totalRows: number;
    distinctProducts: number;
    amountRows: number;
    productJsonRows: number;
    embeddedRows: number;
    categoryCandidatesCachedRows: number;
    categoryCandidatesRefreshedAt: string | null;
  };
  tables: TextEmbeddingsMaintenanceTableStats[];
  indexes: TextEmbeddingsMaintenanceIndexStatus[];
  activeRebuilds: TextEmbeddingsMaintenanceProgress[];
  recentLogs: MaintenanceActionLog[];
};

export type TextEmbeddingsMaintenanceActionResult = {
  ok: true;
  action: TextEmbeddingsMaintenanceAction;
  message: string;
  executedAt: string;
};

const MAINTENANCE_INDEX_NAMES = [
  "product_text_embeddings_embedding_hnsw_idx",
  "product_text_embeddings_amount_idx",
  "product_text_embeddings_product_id_idx",
  "product_text_embeddings_product_json_latest_idx",
] as const;

const VALID_ACTIONS: TextEmbeddingsMaintenanceAction[] = [
  "analyze_table",
  "rebuild_hnsw_index",
  "repair_amount_index",
  "refresh_category_candidates_cache",
];

const HNSW_INDEX_SQL = `
CREATE INDEX CONCURRENTLY product_text_embeddings_embedding_hnsw_idx
  ON public.product_text_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
`;

const AMOUNT_INDEX_SQL = `
CREATE INDEX CONCURRENTLY product_text_embeddings_amount_idx
  ON public.product_text_embeddings (amount)
  WHERE amount IS NOT NULL
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

export function isTextEmbeddingsMaintenanceAction(
  value: unknown
): value is TextEmbeddingsMaintenanceAction {
  return (
    typeof value === "string" &&
    VALID_ACTIONS.includes(value as TextEmbeddingsMaintenanceAction)
  );
}

export async function getTextEmbeddingsMaintenanceState(): Promise<TextEmbeddingsMaintenanceState> {
  const db = getDb();

  const summaryRows = (await db`
    select
      count(*)::int as total_rows,
      count(distinct product_id)::int as distinct_products,
      count(*) filter (where amount is not null)::int as amount_rows,
      count(*) filter (where text_source = 'product_json')::int as product_json_rows,
      count(*) filter (where embedding is not null)::int as embedded_rows
    from public.product_text_embeddings
  `) as Array<{
    total_rows: number;
    distinct_products: number;
    amount_rows: number;
    product_json_rows: number;
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
      and relname = 'product_text_embeddings'
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
    where relid = 'public.product_text_embeddings'::regclass
    order by pid
  `) as Array<{
    process_id: number;
    phase: string;
    blocks_total: number;
    blocks_done: number;
    tuples_done: number;
  }>;
  let categoryCandidatesCachedRows = 0;
  let categoryCandidatesRefreshedAt: string | null = null;

  try {
    const categoryCacheRows = (await db`
      select
        count(*)::int as cached_rows,
        max(refreshed_at) as refreshed_at
      from public.recommend_category_candidates_cache
    `) as Array<{
      cached_rows: number;
      refreshed_at: Date | null;
    }>;

    categoryCandidatesCachedRows = categoryCacheRows[0]?.cached_rows ?? 0;
    categoryCandidatesRefreshedAt =
      categoryCacheRows[0]?.refreshed_at?.toISOString() ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("recommend_category_candidates_cache")) {
      throw error;
    }
  }

  const recentLogs = await listMaintenanceActionLogs("product_text_embeddings");

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      totalRows: summaryRows[0]?.total_rows ?? 0,
      distinctProducts: summaryRows[0]?.distinct_products ?? 0,
      amountRows: summaryRows[0]?.amount_rows ?? 0,
      productJsonRows: summaryRows[0]?.product_json_rows ?? 0,
      embeddedRows: summaryRows[0]?.embedded_rows ?? 0,
      categoryCandidatesCachedRows,
      categoryCandidatesRefreshedAt,
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
    recentLogs,
  };
}

async function analyzeTable() {
  const db = getMaintenanceDb();
  await db.query("ANALYZE public.product_text_embeddings");
}

async function rebuildHnswIndex() {
  const db = getMaintenanceDb();
  await db.query(
    "DROP INDEX CONCURRENTLY IF EXISTS public.product_text_embeddings_embedding_hnsw_idx"
  );
  await db.query(HNSW_INDEX_SQL);
  await db.query("ANALYZE public.product_text_embeddings");
}

async function repairAmountIndex() {
  const db = getMaintenanceDb();
  await db.query(
    "DROP INDEX CONCURRENTLY IF EXISTS public.product_text_embeddings_amount_idx"
  );
  await db.query(AMOUNT_INDEX_SQL);
  await db.query("ANALYZE public.product_text_embeddings");
}

async function refreshCategoryCandidatesCache() {
  await refreshRecommendCategoryCandidatesCache();
}

export async function runTextEmbeddingsMaintenanceAction(
  action: TextEmbeddingsMaintenanceAction
): Promise<TextEmbeddingsMaintenanceActionResult> {
  if (action === "analyze_table") {
    await analyzeTable();
    return {
      ok: true,
      action,
      message: "product_text_embeddings に ANALYZE を実行しました。",
      executedAt: new Date().toISOString(),
    };
  }

  if (action === "rebuild_hnsw_index") {
    await rebuildHnswIndex();
    return {
      ok: true,
      action,
      message:
        "product_text_embeddings の HNSW index を再構築し、ANALYZE を実行しました。",
      executedAt: new Date().toISOString(),
    };
  }

  if (action === "repair_amount_index") {
    await repairAmountIndex();
    return {
      ok: true,
      action,
      message:
        "product_text_embeddings_amount_idx を再作成し、ANALYZE を実行しました。",
      executedAt: new Date().toISOString(),
    };
  }

  await refreshCategoryCandidatesCache();
  return {
    ok: true,
    action,
    message:
      "recommend_category_candidates_cache を更新しました。",
    executedAt: new Date().toISOString(),
  };
}
