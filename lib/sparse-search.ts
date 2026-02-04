/**
 * Sparse Search (pg_trgm-based)
 * Optimized text search using pg_trgm similarity for Japanese queries
 * Uses search_text column for better relevance (name + categories + description)
 *
 * This provides the "Sparse" component in 3-Way RRF Hybrid Search:
 * - Dense: pgvector embeddings (semantic similarity)
 * - Sparse: pg_trgm similarity (text matching) <- THIS MODULE
 * - Keyword: ILIKE exact matching
 */
import { getDb } from "@/lib/neon";
import type { SearchMatch, TextMetadata } from "@/lib/image-text-search";

/**
 * SQLリテラル用に文字列をエスケープ
 */
function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Search using pg_trgm similarity on search_text column
 * Best for short Japanese queries like "お肉", "みかん"
 *
 * @param options.query - Search query
 * @param options.topK - Maximum results to return
 * @param options.minSimilarity - Minimum similarity threshold (default: 0.05 for short queries)
 * @param options.amountMin - Minimum amount filter
 * @param options.amountMax - Maximum amount filter
 */
export async function searchBySparse(options: {
  query: string;
  topK: number;
  minSimilarity?: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<SearchMatch[]> {
  const db = getDb();
  const { query, topK, minSimilarity = 0.05, amountMin, amountMax } = options;

  const trimmed = query.trim();
  if (!trimmed) return [];

  // For short queries (1-3 chars), use lower threshold
  const effectiveThreshold = trimmed.length <= 3 ? Math.min(minSimilarity, 0.03) : minSimilarity;

  // Use ILIKE for initial filtering (uses GIN index), then score with similarity()
  const pattern = `%${trimmed}%`;

  const rows = (await db`
    WITH sparse_matches AS (
      SELECT
        id,
        product_id,
        city_code,
        text,
        metadata,
        amount,
        -- pg_trgm similarity on search_text (optimized column)
        -- Falls back to text column if search_text is NULL
        similarity(COALESCE(search_text, text), ${trimmed}) as sparse_score
      FROM product_text_embeddings
      WHERE
        -- Use ILIKE for index-accelerated filtering
        COALESCE(search_text, text) ILIKE ${pattern}
        ${amountMin !== null && amountMin !== undefined ? db`AND amount >= ${amountMin}` : db``}
        ${amountMax !== null && amountMax !== undefined ? db`AND amount <= ${amountMax}` : db``}
    )
    SELECT *
    FROM sparse_matches
    WHERE sparse_score >= ${effectiveThreshold}
    ORDER BY sparse_score DESC, amount ASC NULLS LAST
    LIMIT ${topK}
  `) as Array<{
    id: string;
    product_id: string;
    city_code: string | null;
    text: string;
    metadata: TextMetadata | null;
    amount: number | null;
    sparse_score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.sparse_score),
    amount: row.amount ?? null,
  }));
}

/**
 * Search using multiple keywords with pg_trgm similarity
 * Combines scores from all keywords using maximum strategy
 *
 * @param options.keywords - Array of keywords to search
 * @param options.topK - Maximum results to return
 * @param options.minSimilarity - Minimum similarity threshold
 * @param options.amountMin - Minimum amount filter
 * @param options.amountMax - Maximum amount filter
 */
export async function searchBySparseKeywords(options: {
  keywords: string[];
  topK: number;
  minSimilarity?: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<SearchMatch[]> {
  const db = getDb();
  const { keywords, topK, minSimilarity = 0.05, amountMin, amountMax } = options;

  if (keywords.length === 0) return [];

  // Sanitize keywords
  const sanitizedKeywords = keywords
    .map((kw) => kw.trim())
    .filter((kw) => kw.length > 0);

  if (sanitizedKeywords.length === 0) return [];

  // Build ILIKE conditions for filtering (using escaped values)
  const ilikeConditions = sanitizedKeywords
    .map((kw) => `COALESCE(search_text, text) ILIKE ${escapeSqlString(`%${kw}%`)}`)
    .join(" OR ");

  // Build similarity calculations for scoring (using escaped values)
  const similarityCalcs = sanitizedKeywords
    .map((kw) => `similarity(COALESCE(search_text, text), ${escapeSqlString(kw)})`)
    .join(", ");

  // Determine threshold based on shortest keyword
  const minKeywordLength = Math.min(...sanitizedKeywords.map((kw) => kw.length));
  const effectiveThreshold = minKeywordLength <= 3 ? Math.min(minSimilarity, 0.03) : minSimilarity;

  const rows = (await db.unsafe(
    `
    WITH sparse_matches AS (
      SELECT
        id,
        product_id,
        city_code,
        text,
        metadata,
        amount,
        -- Use maximum similarity across all keywords
        GREATEST(${similarityCalcs}) as sparse_score
      FROM product_text_embeddings
      WHERE (${ilikeConditions})
        ${amountMin !== null && amountMin !== undefined ? `AND amount >= ${Number(amountMin)}` : ""}
        ${amountMax !== null && amountMax !== undefined ? `AND amount <= ${Number(amountMax)}` : ""}
    )
    SELECT *
    FROM sparse_matches
    WHERE sparse_score >= ${effectiveThreshold}
    ORDER BY sparse_score DESC, amount ASC NULLS LAST
    LIMIT ${topK}
    `
  )) as unknown as Array<{
    id: string;
    product_id: string;
    city_code: string | null;
    text: string;
    metadata: TextMetadata | null;
    amount: number | null;
    sparse_score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.sparse_score),
    amount: row.amount ?? null,
  }));
}

/**
 * Get category keywords for boosting
 * Returns keywords associated with a category name
 */
export async function getCategoryKeywords(categoryName: string): Promise<string[]> {
  const db = getDb();

  try {
    const rows = (await db`
      SELECT keywords
      FROM category_keywords
      WHERE category_name = ${categoryName}
    `) as Array<{ keywords: string[] }>;

    if (rows.length > 0 && rows[0].keywords) {
      return rows[0].keywords;
    }
  } catch {
    // Table might not exist yet, return empty
  }

  return [];
}

/**
 * Detect if query matches a known category
 * Returns category name if matched, null otherwise
 */
export async function detectQueryCategory(query: string): Promise<string | null> {
  const db = getDb();
  const trimmed = query.trim().toLowerCase();

  try {
    const rows = (await db`
      SELECT category_name
      FROM category_keywords
      WHERE ${trimmed} = ANY(keywords)
         OR ${trimmed} ILIKE '%' || category_name || '%'
      LIMIT 1
    `) as Array<{ category_name: string }>;

    if (rows.length > 0) {
      return rows[0].category_name;
    }
  } catch {
    // Table might not exist yet
  }

  // Fallback: hardcoded category detection for common queries
  const categoryPatterns: Record<string, string[]> = {
    肉: ["肉", "お肉", "牛肉", "豚肉", "鶏肉", "和牛", "ステーキ", "焼肉"],
    魚介: ["魚", "海鮮", "刺身", "寿司", "鮭", "まぐろ", "いくら", "うに", "かに", "えび", "ほたて"],
    米: ["米", "お米", "新米", "精米", "玄米", "コシヒカリ"],
    果物: ["果物", "フルーツ", "りんご", "みかん", "ぶどう", "シャインマスカット", "もも", "いちご", "メロン"],
    野菜: ["野菜", "トマト", "きゅうり", "なす", "じゃがいも", "たまねぎ"],
    酒: ["酒", "お酒", "日本酒", "焼酎", "ビール", "ワイン"],
    スイーツ: ["スイーツ", "お菓子", "ケーキ", "チョコ", "アイス", "プリン"],
  };

  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    if (patterns.some((p) => trimmed.includes(p) || p.includes(trimmed))) {
      return category;
    }
  }

  return null;
}

/**
 * Check if a product matches a category based on its metadata
 */
export function productMatchesCategory(
  metadata: TextMetadata | null,
  targetCategory: string
): boolean {
  if (!metadata) return false;

  const raw = metadata.raw as Record<string, unknown> | undefined;
  if (!raw) return false;

  const categories = raw.categories as Array<{
    category1_name?: string;
    category2_name?: string;
    category3_name?: string;
  }> | undefined;

  if (!categories || !Array.isArray(categories)) return false;

  const targetLower = targetCategory.toLowerCase();

  return categories.some((cat) => {
    const cat1 = (cat.category1_name ?? "").toLowerCase();
    const cat2 = (cat.category2_name ?? "").toLowerCase();
    const cat3 = (cat.category3_name ?? "").toLowerCase();

    return (
      cat1.includes(targetLower) ||
      cat2.includes(targetLower) ||
      cat3.includes(targetLower) ||
      targetLower.includes(cat1) ||
      targetLower.includes(cat2) ||
      targetLower.includes(cat3)
    );
  });
}
