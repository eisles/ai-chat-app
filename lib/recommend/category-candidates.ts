import { getDb } from "@/lib/neon";

export type CategoryCandidate = {
  name: string;
  count: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CATEGORY_QUICK_REPLIES = [
  "肉",
  "魚介",
  "果物",
  "米・パン",
  "スイーツ",
  "旅行・体験",
  "温泉",
];
const COVERAGE_KEYWORD_RE = /(旅行|体験|温泉|宿泊|チケット|アクティビティ)/;

let cachedAt = 0;
let cachedCategories: CategoryCandidate[] = [];

function setCachedCategories(categories: CategoryCandidate[]) {
  cachedCategories = categories;
  cachedAt = Date.now();
}

export function clearRecommendCategoryCandidatesMemoryCache() {
  cachedCategories = [];
  cachedAt = 0;
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

async function listCachedRecommendCategoryCandidates(
  limit: number,
  minCount: number
): Promise<CategoryCandidate[]> {
  const db = getDb();

  try {
    const rows = (await db`
      select name, count
      from public.recommend_category_candidates_cache
      where count >= ${minCount}
      order by count desc, name asc
      limit ${limit}
    `) as Array<{ name: string; count: number }>;

    return rows.map((row) => ({
      name: row.name,
      count: row.count,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("recommend_category_candidates_cache")) {
      return [];
    }
    throw error;
  }
}

export async function refreshRecommendCategoryCandidatesCache() {
  const db = getDb();
  const rows = (await db`
    WITH source AS (
      SELECT DISTINCT ON (product_id)
        metadata
      FROM public.product_text_embeddings
      WHERE text_source = 'product_json'
        AND metadata IS NOT NULL
      ORDER BY product_id, updated_at DESC NULLS LAST
    ),
    extracted AS (
      SELECT btrim(name) AS name
      FROM source s
      CROSS JOIN LATERAL (
        SELECT c->>'category1_name' AS name
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(s.metadata->'raw'->'categories') = 'array'
              THEN s.metadata->'raw'->'categories'
            ELSE '[]'::jsonb
          END
        ) AS c
        UNION ALL
        SELECT c->>'category2_name' AS name
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(s.metadata->'raw'->'categories') = 'array'
              THEN s.metadata->'raw'->'categories'
            ELSE '[]'::jsonb
          END
        ) AS c
        UNION ALL
        SELECT c->>'category3_name' AS name
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(s.metadata->'raw'->'categories') = 'array'
              THEN s.metadata->'raw'->'categories'
            ELSE '[]'::jsonb
          END
        ) AS c
        UNION ALL
        SELECT s.metadata->'raw'->>'category' AS name
        UNION ALL
        SELECT s.metadata->'raw'->>'category_name' AS name
        UNION ALL
        SELECT s.metadata->'raw'->>'genre' AS name
        UNION ALL
        SELECT s.metadata->'raw'->>'genre_name' AS name
        UNION ALL
        SELECT s.metadata->'raw'->>'product_type' AS name
        UNION ALL
        SELECT s.metadata->'raw'->>'item_type' AS name
      ) AS v
      WHERE name IS NOT NULL AND btrim(name) <> ''
    )
    SELECT name, count(*)::int AS count
    FROM extracted
    GROUP BY name
    ORDER BY count DESC, name ASC
  `) as CategoryCandidate[];

  try {
    await db`delete from public.recommend_category_candidates_cache`;
    if (rows.length > 0) {
      const names = rows.map((row) => row.name);
      const counts = rows.map((row) => row.count);
      await db`
        insert into public.recommend_category_candidates_cache (
          name,
          count,
          refreshed_at
        )
        select
          entry_name,
          entry_count,
          now()
        from unnest(
          ${names}::text[],
          ${counts}::integer[]
        ) as entries(entry_name, entry_count)
      `;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("recommend_category_candidates_cache")) {
      throw error;
    }
  }

  setCachedCategories(rows);
  return rows;
}

export async function getRecommendCategoryCandidates(
  limit = 20,
  minCount = 2
): Promise<CategoryCandidate[]> {
  const now = Date.now();
  if (cachedCategories.length > 0 && now - cachedAt < CACHE_TTL_MS) {
    return cachedCategories.slice(0, limit);
  }
  const categories = await listCachedRecommendCategoryCandidates(limit, minCount);
  if (categories.length === 0) {
    return [];
  }

  setCachedCategories(categories);
  return categories.slice(0, limit);
}

export async function getRecommendCategoryQuickReplies(
  fallbackReplies: string[] = DEFAULT_CATEGORY_QUICK_REPLIES,
  limit = 12
): Promise<string[]> {
  try {
    const categories = await getRecommendCategoryCandidates(60, 1);
    if (categories.length === 0) {
      return dedupe(fallbackReplies).slice(0, limit);
    }
    const dynamic = categories.map((category) => category.name);
    const coveragePriority = dynamic.filter((name) => COVERAGE_KEYWORD_RE.test(name));
    return dedupe([
      ...fallbackReplies,
      ...coveragePriority,
      ...dynamic,
    ]).slice(0, limit);
  } catch {
    return dedupe(fallbackReplies).slice(0, limit);
  }
}
