/**
 * Query Type Detection for Dynamic Search Weighting
 * クエリの特性を分析し、最適な検索重みを決定する
 */

export type QueryType = "conceptual" | "keyword" | "mixed";

export interface QueryAnalysis {
  type: QueryType;
  confidence: number;
  suggestedWeights: {
    dense: number;
    sparse: number;
    keyword: number;
  };
  features: {
    queryLength: number;
    hasSpecificTerms: boolean;
    isQuestion: boolean;
    hasQuantifiers: boolean;
    isShortQuery: boolean;
  };
}

// Patterns that indicate keyword-focused queries
const KEYWORD_PATTERNS = [
  /^[ぁ-んァ-ヶー一-龯]{1,4}$/, // Short Japanese words (1-4 chars)
  /^\d+円/, // Price patterns
  /^[A-Za-z]{1,10}$/, // Short English words
];

// Patterns that indicate conceptual queries
const CONCEPTUAL_PATTERNS = [
  /おすすめ|人気|美味しい|良い|素敵/, // Subjective adjectives
  /探して|見つけて|教えて/, // Action verbs
  /\?|？|でしょうか|ですか/, // Questions
  /ような|みたいな|っぽい/, // Similarity expressions
];

// Specific product terms that should boost keyword weight
const SPECIFIC_TERMS = [
  // 肉類
  "肉",
  "お肉",
  "牛肉",
  "豚肉",
  "鶏肉",
  "和牛",
  "黒毛和牛",
  "ステーキ",
  "焼肉",
  "しゃぶしゃぶ",
  "すき焼き",
  "ハンバーグ",
  // 果物
  "りんご",
  "リンゴ",
  "林檎",
  "みかん",
  "ミカン",
  "いちご",
  "イチゴ",
  "苺",
  "ぶどう",
  "ブドウ",
  "シャインマスカット",
  "メロン",
  "もも",
  "桃",
  "梨",
  "柿",
  // 魚介
  "鰻",
  "うなぎ",
  "ウナギ",
  "蟹",
  "カニ",
  "かに",
  "海老",
  "エビ",
  "えび",
  "いくら",
  "うに",
  "ウニ",
  "まぐろ",
  "マグロ",
  "鮭",
  "サーモン",
  "ほたて",
  "ホタテ",
  // 米
  "米",
  "お米",
  "コシヒカリ",
  "新米",
  // 酒
  "日本酒",
  "焼酎",
  "ワイン",
  "ビール",
  "地酒",
  // スイーツ
  "スイーツ",
  "ケーキ",
  "チョコ",
  "アイス",
];

/**
 * Analyze query to determine optimal search strategy
 * クエリを分析して最適な検索戦略を決定
 */
export function analyzeQuery(query: string, keywords: string[]): QueryAnalysis {
  const trimmedQuery = query.trim();

  const features = {
    queryLength: trimmedQuery.length,
    hasSpecificTerms: false,
    isQuestion: false,
    hasQuantifiers: false,
    isShortQuery: trimmedQuery.length <= 4,
  };

  // Check for specific product terms
  features.hasSpecificTerms =
    keywords.some((kw) =>
      SPECIFIC_TERMS.some(
        (term) =>
          kw.toLowerCase().includes(term.toLowerCase()) ||
          term.toLowerCase().includes(kw.toLowerCase())
      )
    ) ||
    SPECIFIC_TERMS.some(
      (term) =>
        trimmedQuery.toLowerCase().includes(term.toLowerCase()) ||
        term.toLowerCase().includes(trimmedQuery.toLowerCase())
    );

  // Check for question patterns
  features.isQuestion = /\?|？|ですか|でしょうか|かな/.test(trimmedQuery);

  // Check for quantifiers (price, amount, etc.)
  features.hasQuantifiers = /\d+[円個kgKG]/.test(trimmedQuery);

  // Calculate scores
  let keywordScore = 0;
  let conceptualScore = 0;

  // Short queries favor keyword search
  if (trimmedQuery.length <= 3) keywordScore += 3;
  else if (trimmedQuery.length <= 5) keywordScore += 2;
  else if (trimmedQuery.length <= 8) keywordScore += 1;

  // Specific terms favor keyword search
  if (features.hasSpecificTerms) keywordScore += 2;

  // Quantifiers favor keyword search
  if (features.hasQuantifiers) keywordScore += 1;

  // Check patterns
  if (KEYWORD_PATTERNS.some((p) => p.test(trimmedQuery))) keywordScore += 2;
  if (CONCEPTUAL_PATTERNS.some((p) => p.test(trimmedQuery))) conceptualScore += 2;

  // Questions favor conceptual search
  if (features.isQuestion) conceptualScore += 1;

  // Long queries with multiple words favor conceptual search
  if (trimmedQuery.length > 15) conceptualScore += 1;

  // Determine type
  let type: QueryType;
  let confidence: number;

  if (keywordScore > conceptualScore + 1) {
    type = "keyword";
    confidence = Math.min(0.95, 0.5 + (keywordScore - conceptualScore) * 0.1);
  } else if (conceptualScore > keywordScore + 1) {
    type = "conceptual";
    confidence = Math.min(0.95, 0.5 + (conceptualScore - keywordScore) * 0.1);
  } else {
    type = "mixed";
    confidence = 0.5;
  }

  // Calculate suggested weights (normalized to sum to ~1.0 for RRF)
  let suggestedWeights: QueryAnalysis["suggestedWeights"];

  switch (type) {
    case "keyword":
      // Emphasize sparse and keyword search for keyword-focused queries
      // For short queries like "お肉", prioritize text matching
      suggestedWeights = features.isShortQuery
        ? { dense: 0.20, sparse: 0.50, keyword: 0.30 }
        : { dense: 0.30, sparse: 0.40, keyword: 0.30 };
      break;
    case "conceptual":
      // Emphasize dense search for conceptual queries
      // Semantic understanding is more important
      suggestedWeights = { dense: 0.55, sparse: 0.25, keyword: 0.20 };
      break;
    case "mixed":
    default:
      // Balanced weights for mixed queries
      suggestedWeights = { dense: 0.40, sparse: 0.35, keyword: 0.25 };
  }

  return {
    type,
    confidence,
    suggestedWeights,
    features,
  };
}

/**
 * Get optimal RRF K value based on query type
 * クエリタイプに基づいて最適なRRF K値を取得
 *
 * Higher K = more emphasis on relevance over rank
 * Lower K = more emphasis on rank position
 */
export function getOptimalRrfK(queryType: QueryType): number {
  switch (queryType) {
    case "keyword":
      // Lower K for keyword queries - top ranks matter more
      return 40;
    case "conceptual":
      // Higher K for conceptual queries - spread out ranking influence
      return 80;
    case "mixed":
    default:
      // Standard K for mixed queries
      return 60;
  }
}

/**
 * Adjust weights based on category detection confidence
 * カテゴリ検出の確信度に基づいて重みを調整
 */
export function adjustWeightsForCategory(
  weights: QueryAnalysis["suggestedWeights"],
  categoryDetected: boolean,
  categoryConfidence: number = 0.5
): QueryAnalysis["suggestedWeights"] {
  if (!categoryDetected) {
    return weights;
  }

  // When category is detected with high confidence,
  // increase sparse/keyword weights for better category matching
  const boost = categoryConfidence * 0.1;

  return {
    dense: Math.max(0.1, weights.dense - boost),
    sparse: weights.sparse + boost * 0.6,
    keyword: weights.keyword + boost * 0.4,
  };
}

/**
 * Quick analysis for simple queries
 * シンプルなクエリ用の高速分析
 */
export function quickAnalyze(query: string): {
  isShortQuery: boolean;
  suggestedStrategy: "keyword-first" | "semantic-first" | "balanced";
} {
  const trimmed = query.trim();
  const isShortQuery = trimmed.length <= 5;

  if (isShortQuery) {
    return { isShortQuery: true, suggestedStrategy: "keyword-first" };
  }

  if (CONCEPTUAL_PATTERNS.some((p) => p.test(trimmed))) {
    return { isShortQuery: false, suggestedStrategy: "semantic-first" };
  }

  return { isShortQuery: false, suggestedStrategy: "balanced" };
}
