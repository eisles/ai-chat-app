/**
 * Search Evaluation API
 * 検索最適化の効果を測定するためのエンドポイント
 */
import {
  generateTextEmbedding,
  searchTextEmbeddings,
} from "@/lib/image-text-search";
import {
  type EvaluationCase,
  type EvaluationResult,
  calculatePrecisionAtK,
  calculateMRR,
  calculateCategoryAccuracy,
  hasIrrelevantInTopK,
  createTextPreview,
  calculateEvaluationSummary,
} from "@/lib/search-evaluation";

export const runtime = "nodejs";

type ProductCategory = {
  category1_name?: string | null;
  category2_name?: string | null;
  category3_name?: string | null;
};

type RawProduct = {
  categories?: ProductCategory[] | null;
};

/**
 * metadataからカテゴリ情報を抽出
 */
function extractCategories(metadata: Record<string, unknown> | null): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = metadata.raw as RawProduct | undefined;
  if (!raw?.categories) return [];

  return raw.categories
    .flatMap((c) => [c.category1_name, c.category2_name, c.category3_name])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0);
}

/**
 * 評価用テストケース
 * 注: mustIncludeProductIds と mustExcludeProductIds は
 * 実際のデータに基づいて設定してください
 */
const EVALUATION_CASES: EvaluationCase[] = [
  {
    id: "meat-basic",
    query: "お肉",
    expectedCategory: "肉",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Basic meat search - should return meat products, not seafood or fruits",
  },
  {
    id: "meat-beef",
    query: "牛肉",
    expectedCategory: "肉",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Beef search - should return beef products",
  },
  {
    id: "fruit-basic",
    query: "果物",
    expectedCategory: "果物",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Basic fruit search",
  },
  {
    id: "fruit-grape",
    query: "シャインマスカット",
    expectedCategory: "果物",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Shine Muscat search - should return grape/fruit products",
  },
  {
    id: "seafood-basic",
    query: "海鮮",
    expectedCategory: "魚介",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Basic seafood search",
  },
  {
    id: "seafood-eel",
    query: "鰻",
    expectedCategory: "魚介",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Eel search - should return eel/seafood products",
  },
  {
    id: "rice-basic",
    query: "お米",
    expectedCategory: "米",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Basic rice search",
  },
  {
    id: "sweets-basic",
    query: "スイーツ",
    expectedCategory: "スイーツ",
    mustIncludeProductIds: [],
    mustExcludeProductIds: [],
    description: "Basic sweets search",
  },
];

/**
 * 単一のテストケースを評価
 */
async function runEvaluation(
  testCase: EvaluationCase,
  options: { topK: number; threshold: number }
): Promise<EvaluationResult> {
  const { topK, threshold } = options;

  // 埋め込み生成と検索
  const embedding = await generateTextEmbedding(testCase.query);
  const matches = await searchTextEmbeddings({
    embedding: embedding.vector,
    topK,
    threshold,
  });

  // 結果をカテゴリ情報付きで整形
  const resultsWithCategories = matches.map((m, index) => ({
    rank: index + 1,
    productId: m.productId,
    score: m.score,
    categories: extractCategories(m.metadata),
    textPreview: createTextPreview(m.text, 100),
  }));

  const resultIds = matches.map((m) => m.productId);
  const mustIncludeSet = new Set(testCase.mustIncludeProductIds);
  const mustExcludeSet = new Set(testCase.mustExcludeProductIds);

  // 各メトリクスを計算
  const metrics = {
    precisionAt5: calculatePrecisionAtK(resultIds, mustIncludeSet, 5),
    precisionAt10: calculatePrecisionAtK(resultIds, mustIncludeSet, 10),
    categoryAccuracyAt5: calculateCategoryAccuracy(
      resultsWithCategories,
      testCase.expectedCategory,
      5
    ),
    categoryAccuracyAt10: calculateCategoryAccuracy(
      resultsWithCategories,
      testCase.expectedCategory,
      10
    ),
    mrr: calculateMRR(resultIds, mustIncludeSet),
    hasIrrelevantInTop5: hasIrrelevantInTopK(resultIds, mustExcludeSet, 5),
    hasIrrelevantInTop10: hasIrrelevantInTopK(resultIds, mustExcludeSet, 10),
  };

  return {
    caseId: testCase.id,
    query: testCase.query,
    metrics,
    topResults: resultsWithCategories.slice(0, 10).map((r) => ({
      ...r,
      categoryMatch: r.categories.some(
        (c) =>
          c.toLowerCase().includes(testCase.expectedCategory.toLowerCase()) ||
          testCase.expectedCategory.toLowerCase().includes(c.toLowerCase())
      ),
    })),
  };
}

/**
 * GET: 全テストケースの評価を実行
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const topK = parseInt(url.searchParams.get("topK") ?? "20", 10);
    const threshold = parseFloat(url.searchParams.get("threshold") ?? "0.3");
    const caseId = url.searchParams.get("caseId");

    // 特定のケースのみ実行する場合
    const casesToRun = caseId
      ? EVALUATION_CASES.filter((c) => c.id === caseId)
      : EVALUATION_CASES;

    if (casesToRun.length === 0) {
      return Response.json(
        { ok: false, error: `Test case not found: ${caseId}` },
        { status: 404 }
      );
    }

    // 全ケースを並列実行
    const results = await Promise.all(
      casesToRun.map((tc) => runEvaluation(tc, { topK, threshold }))
    );

    const summary = calculateEvaluationSummary(results);

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      config: { topK, threshold },
      summary,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Evaluation error:", error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST: カスタムテストケースで評価を実行
 */
export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as {
      query?: string;
      expectedCategory?: string;
      topK?: number;
      threshold?: number;
    };

    if (!payload.query) {
      return Response.json(
        { ok: false, error: "query is required" },
        { status: 400 }
      );
    }

    const testCase: EvaluationCase = {
      id: "custom",
      query: payload.query,
      expectedCategory: payload.expectedCategory ?? "",
      mustIncludeProductIds: [],
      mustExcludeProductIds: [],
      description: "Custom evaluation query",
    };

    const result = await runEvaluation(testCase, {
      topK: payload.topK ?? 20,
      threshold: payload.threshold ?? 0.3,
    });

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Evaluation error:", error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
