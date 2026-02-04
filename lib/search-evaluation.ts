/**
 * Search Evaluation Utilities
 * 検索最適化の効果を定量的に測定するためのユーティリティ
 */

export type EvaluationCase = {
  id: string;
  query: string;
  expectedCategory: string;
  mustIncludeProductIds: string[];
  mustExcludeProductIds: string[];
  description: string;
};

export type EvaluationResult = {
  caseId: string;
  query: string;
  metrics: {
    precisionAt5: number;
    precisionAt10: number;
    categoryAccuracyAt5: number;
    categoryAccuracyAt10: number;
    mrr: number;
    hasIrrelevantInTop5: boolean;
    hasIrrelevantInTop10: boolean;
  };
  topResults: Array<{
    rank: number;
    productId: string;
    score: number;
    categoryMatch: boolean;
    categories: string[];
    textPreview: string;
  }>;
};

/**
 * Precision@K を計算
 * 上位K件のうち、関連する商品の割合
 */
export function calculatePrecisionAtK(
  resultIds: string[],
  relevantIds: Set<string>,
  k: number
): number {
  if (relevantIds.size === 0) return 0;
  const topK = resultIds.slice(0, k);
  const relevantInTopK = topK.filter((id) => relevantIds.has(id)).length;
  return relevantInTopK / Math.min(k, relevantIds.size);
}

/**
 * MRR (Mean Reciprocal Rank) を計算
 * 最初の関連商品が出現する順位の逆数
 */
export function calculateMRR(
  resultIds: string[],
  relevantIds: Set<string>
): number {
  if (relevantIds.size === 0) return 0;
  const firstRelevantIndex = resultIds.findIndex((id) => relevantIds.has(id));
  if (firstRelevantIndex === -1) return 0;
  return 1 / (firstRelevantIndex + 1);
}

/**
 * Category Accuracy@K を計算
 * 上位K件のうち、期待カテゴリに一致する商品の割合
 */
export function calculateCategoryAccuracy(
  results: Array<{ categories: string[] }>,
  expectedCategory: string,
  k: number
): number {
  if (!expectedCategory) return 0;
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;

  const normalizedExpected = expectedCategory.toLowerCase();
  const matchCount = topK.filter((r) =>
    r.categories.some(
      (cat) =>
        cat.toLowerCase().includes(normalizedExpected) ||
        normalizedExpected.includes(cat.toLowerCase())
    )
  ).length;

  return matchCount / topK.length;
}

/**
 * 上位K件に不適切な商品が含まれているか判定
 */
export function hasIrrelevantInTopK(
  resultIds: string[],
  irrelevantIds: Set<string>,
  k: number
): boolean {
  const topK = resultIds.slice(0, k);
  return topK.some((id) => irrelevantIds.has(id));
}

/**
 * テキストのプレビューを生成（最初のN文字）
 */
export function createTextPreview(text: string, maxLength: number = 100): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/**
 * 評価結果のサマリーを計算
 */
export function calculateEvaluationSummary(results: EvaluationResult[]) {
  if (results.length === 0) {
    return {
      totalCases: 0,
      avgPrecisionAt5: 0,
      avgPrecisionAt10: 0,
      avgCategoryAccuracyAt5: 0,
      avgCategoryAccuracyAt10: 0,
      avgMRR: 0,
      casesWithIrrelevantInTop5: 0,
      casesWithIrrelevantInTop10: 0,
    };
  }

  const sum = results.reduce(
    (acc, r) => ({
      precisionAt5: acc.precisionAt5 + r.metrics.precisionAt5,
      precisionAt10: acc.precisionAt10 + r.metrics.precisionAt10,
      categoryAccuracyAt5: acc.categoryAccuracyAt5 + r.metrics.categoryAccuracyAt5,
      categoryAccuracyAt10: acc.categoryAccuracyAt10 + r.metrics.categoryAccuracyAt10,
      mrr: acc.mrr + r.metrics.mrr,
      irrelevantTop5: acc.irrelevantTop5 + (r.metrics.hasIrrelevantInTop5 ? 1 : 0),
      irrelevantTop10: acc.irrelevantTop10 + (r.metrics.hasIrrelevantInTop10 ? 1 : 0),
    }),
    {
      precisionAt5: 0,
      precisionAt10: 0,
      categoryAccuracyAt5: 0,
      categoryAccuracyAt10: 0,
      mrr: 0,
      irrelevantTop5: 0,
      irrelevantTop10: 0,
    }
  );

  const count = results.length;
  return {
    totalCases: count,
    avgPrecisionAt5: sum.precisionAt5 / count,
    avgPrecisionAt10: sum.precisionAt10 / count,
    avgCategoryAccuracyAt5: sum.categoryAccuracyAt5 / count,
    avgCategoryAccuracyAt10: sum.categoryAccuracyAt10 / count,
    avgMRR: sum.mrr / count,
    casesWithIrrelevantInTop5: sum.irrelevantTop5,
    casesWithIrrelevantInTop10: sum.irrelevantTop10,
  };
}
