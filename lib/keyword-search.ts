/**
 * Keyword-based Search
 * ベクトル検索を補完するキーワードベースの検索
 * pg_trgm の similarity() を使用してTF-IDF風のスコアリングを実現
 */
import { getDb } from "@/lib/neon";
import type { SearchMatch, TextMetadata } from "@/lib/image-text-search";

/**
 * SQLリテラル用に文字列をエスケープ
 * シングルクォートを2重にしてSQLインジェクションを防ぐ
 */
function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * キーワードベースの検索（pg_trgm similarity使用）
 * ILIKE でマッチングし、similarity() でスコアリング
 * 単純なパターンマッチよりも関連性の高い結果を返す
 */
export async function searchByKeywords(options: {
  keywords: string[];
  topK: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<SearchMatch[]> {
  const db = getDb();
  const { keywords, topK, amountMin, amountMax } = options;

  if (keywords.length === 0) return [];

  // キーワードをサニタイズ
  const sanitizedKeywords = keywords
    .map((kw) => kw.trim())
    .filter((kw) => kw.length > 0);

  if (sanitizedKeywords.length === 0) return [];

  // ILIKE パターンを作成
  const patterns = sanitizedKeywords.map((kw) => `%${kw}%`);

  // 検索クエリ文字列（similarity計算用）
  const searchQuery = sanitizedKeywords.join(" ");

  const rows = (await db`
    WITH keyword_matches AS (
      SELECT
        id,
        product_id,
        city_code,
        text,
        metadata,
        amount,
        -- pg_trgm similarity でスコアリング（0.0〜1.0）
        -- 複数キーワードの場合は各キーワードとのsimilarityの最大値を使用
        GREATEST(
          ${db.unsafe(
            sanitizedKeywords
              .map((kw) => `similarity(text, ${escapeSqlString(kw)})`)
              .join(", ")
          )}
        ) as keyword_score
      FROM product_text_embeddings
      WHERE (
        ${db.unsafe(
          patterns
            .map((p) => `text ILIKE ${escapeSqlString(p)}`)
            .join(" OR ")
        )}
      )
      ${amountMin !== null && amountMin !== undefined ? db`AND amount >= ${amountMin}` : db``}
      ${amountMax !== null && amountMax !== undefined ? db`AND amount <= ${amountMax}` : db``}
    )
    SELECT *
    FROM keyword_matches
    WHERE keyword_score > 0
    ORDER BY keyword_score DESC, amount ASC NULLS LAST
    LIMIT ${topK}
  `) as Array<{
    id: string;
    product_id: string;
    city_code: string | null;
    text: string;
    metadata: TextMetadata | null;
    amount: number | null;
    keyword_score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.keyword_score),
    amount: row.amount ?? null,
  }));
}

/**
 * シンプルなキーワード検索（単一キーワード）
 * pg_trgm similarity でスコアリング
 */
export async function searchBySingleKeyword(options: {
  keyword: string;
  topK: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<SearchMatch[]> {
  const db = getDb();
  const { keyword, topK, amountMin, amountMax } = options;

  const trimmed = keyword.trim();
  if (!trimmed) return [];

  const pattern = `%${trimmed}%`;

  const rows = (await db`
    SELECT
      id,
      product_id,
      city_code,
      text,
      metadata,
      amount,
      -- pg_trgm similarity でスコアリング
      similarity(text, ${trimmed}) as keyword_score
    FROM product_text_embeddings
    WHERE text ILIKE ${pattern}
      ${amountMin !== null && amountMin !== undefined ? db`AND amount >= ${amountMin}` : db``}
      ${amountMax !== null && amountMax !== undefined ? db`AND amount <= ${amountMax}` : db``}
    ORDER BY keyword_score DESC, amount ASC NULLS LAST
    LIMIT ${topK}
  `) as Array<{
    id: string;
    product_id: string;
    city_code: string | null;
    text: string;
    metadata: TextMetadata | null;
    amount: number | null;
    keyword_score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.keyword_score),
    amount: row.amount ?? null,
  }));
}

/**
 * 全文検索（tsvector + ts_rank使用）
 * 日本語は'simple'設定で対応（スペース区切り前提）
 * 事前にテキストを正規化している場合に有効
 */
export async function searchByFullText(options: {
  query: string;
  topK: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<SearchMatch[]> {
  const db = getDb();
  const { query, topK, amountMin, amountMax } = options;

  const trimmed = query.trim();
  if (!trimmed) return [];

  // スペースで区切られた単語をOR検索
  const tsQuery = trimmed.split(/\s+/).join(" | ");

  const rows = (await db`
    SELECT
      id,
      product_id,
      city_code,
      text,
      metadata,
      amount,
      ts_rank(
        to_tsvector('simple', text),
        to_tsquery('simple', ${tsQuery})
      ) as keyword_score
    FROM product_text_embeddings
    WHERE to_tsvector('simple', text) @@ to_tsquery('simple', ${tsQuery})
      ${amountMin !== null && amountMin !== undefined ? db`AND amount >= ${amountMin}` : db``}
      ${amountMax !== null && amountMax !== undefined ? db`AND amount <= ${amountMax}` : db``}
    ORDER BY keyword_score DESC, amount ASC NULLS LAST
    LIMIT ${topK}
  `) as Array<{
    id: string;
    product_id: string;
    city_code: string | null;
    text: string;
    metadata: TextMetadata | null;
    amount: number | null;
    keyword_score: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    cityCode: row.city_code ?? null,
    text: row.text,
    metadata: row.metadata ?? null,
    score: Number(row.keyword_score),
    amount: row.amount ?? null,
  }));
}
