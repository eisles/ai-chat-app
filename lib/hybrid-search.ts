/**
 * 3-Way RRF Hybrid Search
 * Dense (pgvector) + Sparse (pg_trgm) + Keyword (ILIKE) を RRF で統合
 *
 * RRF (Reciprocal Rank Fusion):
 *   score = Σ weight_i / (k + rank_i)
 *   k = 60 (standard)
 */
import {
  generateTextEmbedding,
  searchTextEmbeddings,
  type SearchMatch,
} from "@/lib/image-text-search";
import { searchByKeywords } from "@/lib/keyword-search";
import {
  searchBySparse,
  detectQueryCategory,
  productMatchesCategory,
} from "@/lib/sparse-search";
import {
  analyzeQuery,
  getOptimalRrfK,
  type QueryAnalysis,
} from "@/lib/query-analyzer";

// RRF定数
const DEFAULT_RRF_K = 60;

// デフォルト重み（Dense:Sparse:Keyword）
const DEFAULT_WEIGHTS = {
  dense: 0.4,
  sparse: 0.35,
  keyword: 0.25,
};

// 短いクエリ用の重み（キーワードマッチを重視）
const SHORT_QUERY_WEIGHTS = {
  dense: 0.25,
  sparse: 0.45,
  keyword: 0.30,
};

// カテゴリブースト値
const CATEGORY_BOOST = {
  match: 0.15,    // カテゴリ一致時のボーナス
  mismatch: -0.10, // カテゴリ不一致時のペナルティ
};

export type HybridSearchOptions = {
  query: string;
  keywords: string[];
  topK?: number;
  threshold?: number;
  rrfK?: number;
  weights?: {
    dense: number;
    sparse: number;
    keyword: number;
  };
  // 検索方式の有効/無効
  useDenseSearch?: boolean;
  useSparseSearch?: boolean;
  useKeywordSearch?: boolean;
  useCategoryBoost?: boolean;
  // クエリ分析による動的重み調整
  useQueryAnalyzer?: boolean;
  // フィルタ
  amountMin?: number | null;
  amountMax?: number | null;
  // 推論されたカテゴリ（外部から渡す場合）
  inferredCategory?: string | null;
};

export type HybridSearchResult = {
  matches: SearchMatch[];
  searchStats: {
    denseResults: number;
    sparseResults: number;
    keywordResults: number;
    mergedResults: number;
    detectedCategory: string | null;
  };
  searchMode: string;
  // クエリ分析結果（useQueryAnalyzer=true の場合）
  queryAnalysis?: QueryAnalysis;
};

type RankedResult = {
  match: SearchMatch;
  rrfScore: number;
  sources: string[];
  categoryBoost: number;
};

/**
 * クエリの特性に基づいて最適な重みを決定（レガシー関数）
 */
function getOptimalWeightsLegacy(query: string, keywords: string[]): {
  dense: number;
  sparse: number;
  keyword: number;
} {
  // 短いクエリ（3文字以下）はキーワード・スパース検索を重視
  const isShortQuery = query.length <= 3 ||
    (keywords.length > 0 && keywords.every((kw) => kw.length <= 3));

  if (isShortQuery) {
    return SHORT_QUERY_WEIGHTS;
  }

  return DEFAULT_WEIGHTS;
}

/**
 * RRFスコアを計算
 */
function calculateWeightedRRFScores(
  results: Map<string, SearchMatch[]>,
  weights: { dense: number; sparse: number; keyword: number },
  k: number = DEFAULT_RRF_K
): Map<string, RankedResult> {
  const scores = new Map<string, RankedResult>();

  for (const [searchType, matches] of results) {
    const weight = weights[searchType as keyof typeof weights] ?? 0.33;

    matches.forEach((match, rank) => {
      const key = match.productId;
      // 重み付きRRFスコア
      const rrfContribution = weight / (k + rank + 1);

      if (scores.has(key)) {
        const existing = scores.get(key)!;
        existing.rrfScore += rrfContribution;
        existing.sources.push(searchType);
        // より高い元スコアを保持
        if (match.score > existing.match.score) {
          existing.match = { ...match };
        }
      } else {
        scores.set(key, {
          match: { ...match },
          rrfScore: rrfContribution,
          sources: [searchType],
          categoryBoost: 0,
        });
      }
    });
  }

  return scores;
}

/**
 * カテゴリブーストを適用
 */
function applyCategoryBoost(
  results: Map<string, RankedResult>,
  targetCategory: string | null
): void {
  if (!targetCategory) return;

  for (const [, result] of results) {
    const matches = productMatchesCategory(result.match.metadata, targetCategory);
    if (matches) {
      result.categoryBoost = CATEGORY_BOOST.match;
    } else {
      // カテゴリが明確に不一致の場合のみペナルティ
      // metadata がない場合はペナルティなし
      if (result.match.metadata) {
        result.categoryBoost = CATEGORY_BOOST.mismatch;
      }
    }
  }
}

/**
 * 3-Way RRF Hybrid Search を実行
 */
export async function executeHybridSearch(
  options: HybridSearchOptions
): Promise<HybridSearchResult> {
  const {
    query,
    keywords,
    topK = 10,
    threshold = 0.5,
    useDenseSearch = true,
    useSparseSearch = true,
    useKeywordSearch = true,
    useCategoryBoost = true,
    useQueryAnalyzer = true, // デフォルトで有効
    amountMin,
    amountMax,
    inferredCategory,
  } = options;

  // クエリ分析による動的重み調整
  let queryAnalysis: QueryAnalysis | undefined;
  let weights: { dense: number; sparse: number; keyword: number };
  let rrfK: number;

  if (useQueryAnalyzer) {
    queryAnalysis = analyzeQuery(query, keywords);
    weights = options.weights ?? queryAnalysis.suggestedWeights;
    rrfK = options.rrfK ?? getOptimalRrfK(queryAnalysis.type);
  } else {
    weights = options.weights ?? getOptimalWeightsLegacy(query, keywords);
    rrfK = options.rrfK ?? DEFAULT_RRF_K;
  }

  // カテゴリを検出（外部から渡されていない場合）
  const detectedCategory = inferredCategory ?? await detectQueryCategory(query);

  // 並列検索を実行
  const searchPromises: Promise<{ type: string; results: SearchMatch[] }>[] = [];
  const fetchMultiplier = 2.5; // 各検索で多めに取得

  // 1. Dense Search (pgvector)
  if (useDenseSearch) {
    searchPromises.push(
      (async () => {
        const searchText = keywords.length > 0 ? keywords.join(" ") : query;
        const embedding = await generateTextEmbedding(searchText);
        const results = await searchTextEmbeddings({
          embedding: embedding.vector,
          topK: Math.ceil(topK * fetchMultiplier),
          threshold,
          amountMin,
          amountMax,
        });
        return { type: "dense", results };
      })()
    );
  }

  // 2. Sparse Search (pg_trgm similarity on search_text)
  if (useSparseSearch) {
    searchPromises.push(
      (async () => {
        const results = await searchBySparse({
          query: keywords.length > 0 ? keywords[0]! : query,
          topK: Math.ceil(topK * fetchMultiplier),
          minSimilarity: 0.03, // 短いクエリ用に低めの閾値
          amountMin,
          amountMax,
        });
        return { type: "sparse", results };
      })()
    );
  }

  // 3. Keyword Search (ILIKE + pg_trgm similarity)
  if (useKeywordSearch && keywords.length > 0) {
    searchPromises.push(
      (async () => {
        const results = await searchByKeywords({
          keywords,
          topK: Math.ceil(topK * fetchMultiplier),
          amountMin,
          amountMax,
        });
        return { type: "keyword", results };
      })()
    );
  }

  // 検索が1つも有効でない場合
  if (searchPromises.length === 0) {
    return {
      matches: [],
      searchStats: {
        denseResults: 0,
        sparseResults: 0,
        keywordResults: 0,
        mergedResults: 0,
        detectedCategory,
      },
      searchMode: "none",
      queryAnalysis,
    };
  }

  // 並列実行
  const searchResults = await Promise.all(searchPromises);

  // 結果をMapに変換
  const resultsMap = new Map<string, SearchMatch[]>();
  const stats = {
    denseResults: 0,
    sparseResults: 0,
    keywordResults: 0,
    mergedResults: 0,
    detectedCategory,
  };

  for (const { type, results } of searchResults) {
    resultsMap.set(type, results);
    if (type === "dense") stats.denseResults = results.length;
    if (type === "sparse") stats.sparseResults = results.length;
    if (type === "keyword") stats.keywordResults = results.length;
  }

  // RRFスコアを計算
  const rankedResults = calculateWeightedRRFScores(resultsMap, weights, rrfK);

  // カテゴリブーストを適用
  if (useCategoryBoost && detectedCategory) {
    applyCategoryBoost(rankedResults, detectedCategory);
  }

  // 最終スコアでソート
  const sortedResults = Array.from(rankedResults.values())
    .map((r) => ({
      ...r.match,
      score: r.rrfScore + r.categoryBoost,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  stats.mergedResults = rankedResults.size;

  // 使用した検索方式を記録
  const enabledMethods: string[] = [];
  if (useDenseSearch) enabledMethods.push("dense");
  if (useSparseSearch) enabledMethods.push("sparse");
  if (useKeywordSearch && keywords.length > 0) enabledMethods.push("keyword");
  if (useCategoryBoost) enabledMethods.push("categoryBoost");

  return {
    matches: sortedResults,
    searchStats: stats,
    searchMode: enabledMethods.join("+"),
    queryAnalysis,
  };
}

/**
 * シンプルなハイブリッド検索（デフォルト設定）
 */
export async function hybridSearch(
  query: string,
  keywords: string[],
  options?: {
    topK?: number;
    amountMin?: number | null;
    amountMax?: number | null;
    inferredCategory?: string | null;
  }
): Promise<SearchMatch[]> {
  const result = await executeHybridSearch({
    query,
    keywords,
    topK: options?.topK ?? 10,
    amountMin: options?.amountMin,
    amountMax: options?.amountMax,
    inferredCategory: options?.inferredCategory,
  });

  return result.matches;
}
