import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.fn();
const listMaintenanceActionLogs = vi.fn();

vi.mock("@/lib/neon", () => ({
  getDb: () => db,
}));

vi.mock("@/lib/maintenance-action-log", () => ({
  listMaintenanceActionLogs,
}));

describe("text embeddings maintenance state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.mockReset();
    listMaintenanceActionLogs.mockResolvedValue([]);
  });

  it("カテゴリ候補 cache の件数と最終更新時刻を返す", async () => {
    db.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("from public.product_text_embeddings")) {
        return Promise.resolve([
          {
            total_rows: 100,
            distinct_products: 80,
            amount_rows: 70,
            product_json_rows: 60,
            embedded_rows: 55,
          },
        ]);
      }
      if (sql.includes("from pg_stat_user_tables")) {
        return Promise.resolve([]);
      }
      if (sql.includes("from pg_index")) {
        return Promise.resolve([]);
      }
      if (sql.includes("from pg_stat_progress_create_index")) {
        return Promise.resolve([]);
      }
      if (sql.includes("from public.recommend_category_candidates_cache")) {
        return Promise.resolve([
          {
            cached_rows: 12,
            refreshed_at: new Date("2026-03-09T13:45:00.000Z"),
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const { getTextEmbeddingsMaintenanceState } = await import(
      "@/lib/text-embeddings-maintenance"
    );
    const state = await getTextEmbeddingsMaintenanceState();

    expect(state.summary.categoryCandidatesCachedRows).toBe(12);
    expect(state.summary.categoryCandidatesRefreshedAt).toBe(
      "2026-03-09T13:45:00.000Z"
    );
  });

  it("カテゴリ候補 cache テーブルが未作成でも落ちずにゼロ扱いにする", async () => {
    db.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("from public.product_text_embeddings")) {
        return Promise.resolve([
          {
            total_rows: 100,
            distinct_products: 80,
            amount_rows: 70,
            product_json_rows: 60,
            embedded_rows: 55,
          },
        ]);
      }
      if (sql.includes("from pg_stat_user_tables")) {
        return Promise.resolve([]);
      }
      if (sql.includes("from pg_index")) {
        return Promise.resolve([]);
      }
      if (sql.includes("from pg_stat_progress_create_index")) {
        return Promise.resolve([]);
      }
      if (sql.includes("from public.recommend_category_candidates_cache")) {
        throw new Error('relation "recommend_category_candidates_cache" does not exist');
      }
      return Promise.resolve([]);
    });

    const { getTextEmbeddingsMaintenanceState } = await import(
      "@/lib/text-embeddings-maintenance"
    );
    const state = await getTextEmbeddingsMaintenanceState();

    expect(state.summary.categoryCandidatesCachedRows).toBe(0);
    expect(state.summary.categoryCandidatesRefreshedAt).toBeNull();
  });
});
