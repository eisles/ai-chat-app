import {
  assertOpenAIError,
  generateTextEmbedding,
  searchTextEmbeddings,
  SearchMatch,
} from "@/lib/image-text-search";
import {
  createCompletion,
  LLMProviderError,
} from "@/lib/llm-providers";

export const runtime = "nodejs";

const DEFAULT_MODEL = "openai:gpt-4o-mini";
const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.6;
const RRF_K = 60; // RRFアルゴリズムの定数
const STOP_WORDS = (process.env.CHAT_RECOMMEND_STOP_WORDS ?? "")
  .split(",")
  .map((w) => w.trim())
  .filter((w) => w.length > 0);

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RecommendPayload = {
  history?: unknown;
  topK?: unknown;
  threshold?: unknown;
  useReranking?: unknown;
  useSimilarSearch?: unknown;
  stopWords?: unknown;
  model?: unknown;
};

function parseHistory(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("history is required", 400);
  }
  return value.trim();
}

function parseTopK(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return DEFAULT_TOP_K;
}

function parseThreshold(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return DEFAULT_THRESHOLD;
}

function parseUseReranking(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  return true;
}

function parseUseSimilarSearch(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  return false;
}

function parseStopWords(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((w) => String(w).trim()).filter((w) => w.length > 0);
  }
  return STOP_WORDS;
}

function parseModel(value: unknown) {
  if (typeof value === "string" && value.includes(":")) {
    return value;
  }
  return DEFAULT_MODEL;
}

type AmountRange = {
  min?: number | null;
  max?: number | null;
};

type KeywordExtractionResult = {
  keywords: string[];
  amountRange: AmountRange | null;
};

type SearchStats = {
  queriesExecuted: number;
  totalCandidates: number;
  uniqueResults: number;
};

async function extractKeywords(history: string, model: string): Promise<KeywordExtractionResult> {
  const response = await createCompletion({
    model,
    messages: [
      {
        role: "system",
        content: `Extract keywords and price range from Japanese text for product search.

Return ONLY valid JSON (no explanation text):
{"keywords":["keyword1","keyword2"],"amountRange":null}

Examples:
- "牛肉の返礼品" → {"keywords":["牛肉"],"amountRange":null}
- "5000円以下のお肉" → {"keywords":["お肉"],"amountRange":{"max":5000}}
- "1万円くらいの海鮮" → {"keywords":["海鮮"],"amountRange":{"min":8500,"max":11500}}
- "いちご 苺 ストロベリー" → {"keywords":["いちご","苺","ストロベリー"],"amountRange":null}

Price rules:
- "〜円以下" → {"max":N}
- "〜円以上" → {"min":N}
- "〜円くらい/前後/程度" → ±15% (min=N*0.85, max=N*1.15)
- 千=1000, 万=10000`,
      },
      {
        role: "user",
        content: history,
      },
    ],
    maxTokens: 300,
    temperature: 0.2,
  });

  const content = response.content;

  const fallbackKeywords = content
    .split(/[,\n、]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  // Extract JSON from response (handle cases where LLM adds explanation text)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonContent = jsonMatch ? jsonMatch[0] : content;

  try {
    const parsed = JSON.parse(jsonContent) as unknown;

    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;

      let keywords: string[] = [];
      if (Array.isArray(obj.keywords)) {
        keywords = obj.keywords.map((item) => String(item)).filter((item) => item.length > 0);
      } else if (Array.isArray(parsed)) {
        keywords = (parsed as unknown[]).map((item) => String(item)).filter((item) => item.length > 0);
        return { keywords, amountRange: null };
      }

      let amountRange: AmountRange | null = null;
      if (obj.amountRange && typeof obj.amountRange === "object") {
        const range = obj.amountRange as Record<string, unknown>;
        const min = typeof range.min === "number" ? range.min : null;
        const max = typeof range.max === "number" ? range.max : null;
        if (min !== null || max !== null) {
          amountRange = { min, max };
        }
      }

      return { keywords, amountRange };
    }

    if (Array.isArray(parsed)) {
      return {
        keywords: (parsed as unknown[]).map((item) => String(item)).filter((item) => item.length > 0),
        amountRange: null,
      };
    }
  } catch {
    // fallback to non-JSON parsing
  }

  return { keywords: fallbackKeywords, amountRange: null };
}

// 類似キーワードをLLMで生成
async function generateSimilarKeywords(
  keyword: string,
  model: string
): Promise<string[]> {
  if (!keyword.trim()) {
    return [];
  }

  const response = await createCompletion({
    model,
    messages: [
      {
        role: "system",
        content: `Generate 3 similar search keywords for Japanese product search.
Consider: synonyms, related terms, different writings (hiragana/katakana/kanji).

Return ONLY valid JSON array (no explanation):
["similar1", "similar2", "similar3"]

Examples:
- "牛肉" → ["和牛", "黒毛和牛", "ビーフ"]
- "りんご" → ["リンゴ", "林檎", "アップル"]
- "みかん" → ["ミカン", "蜜柑", "オレンジ"]
- "いちご" → ["苺", "ストロベリー", "イチゴ"]
- "海鮮" → ["魚介", "シーフード", "海の幸"]
- "ステーキ" → ["牛肉", "ビーフ", "焼肉"]`,
      },
      {
        role: "user",
        content: keyword,
      },
    ],
    maxTokens: 100,
    temperature: 0.3,
  });

  const content = response.content.trim();

  try {
    // JSONの配列を抽出
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const jsonContent = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonContent) as unknown;

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0 && item !== keyword)
        .slice(0, 3);
    }
  } catch {
    // パースエラー時は空配列を返す
  }

  return [];
}

// 並列検索を実行
async function executeParallelSearches(options: {
  keywords: string[];
  topK: number;
  threshold: number;
  amountMin?: number | null;
  amountMax?: number | null;
}): Promise<Map<string, SearchMatch[]>> {
  const results = new Map<string, SearchMatch[]>();

  // 重複キーワードを除去
  const uniqueKeywords = [...new Set(options.keywords)];

  // 並列でembedding生成と検索を実行
  const searchPromises = uniqueKeywords.map(async (keyword) => {
    const embedding = await generateTextEmbedding(keyword);
    const matches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK: options.topK,
      threshold: options.threshold,
      amountMin: options.amountMin,
      amountMax: options.amountMax,
    });
    return { keyword, matches };
  });

  const searchResults = await Promise.all(searchPromises);

  for (const { keyword, matches } of searchResults) {
    results.set(keyword, matches);
  }

  return results;
}

// Reciprocal Rank Fusion (RRF) でスコアを計算
function calculateRRFScores(
  searchResults: Map<string, SearchMatch[]>,
  k: number = RRF_K
): SearchMatch[] {
  const scores = new Map<string, { match: SearchMatch; rrfScore: number; sources: string[] }>();

  for (const [queryKeyword, results] of searchResults) {
    results.forEach((match, rank) => {
      const key = match.productId;
      const rrfContribution = 1 / (k + rank + 1);

      if (scores.has(key)) {
        const existing = scores.get(key)!;
        existing.rrfScore += rrfContribution;
        existing.sources.push(queryKeyword);
        // より高い元スコアを保持
        if (match.score > existing.match.score) {
          existing.match = { ...match };
        }
      } else {
        scores.set(key, {
          match: { ...match },
          rrfScore: rrfContribution,
          sources: [queryKeyword],
        });
      }
    });
  }

  // RRFスコアでソートして返す
  return Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ match, rrfScore }) => ({
      ...match,
      score: rrfScore,
    }));
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }

  if (error instanceof LLMProviderError) {
    const status = error.status === 429 ? 429 : error.status >= 500 ? 502 : error.status;
    return Response.json({ ok: false, error: error.message }, { status });
  }

  const openAIError = assertOpenAIError(error);
  if (openAIError) {
    const status = openAIError.status === 429 ? 429 : 502;
    return Response.json({ ok: false, error: openAIError.message }, { status });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as RecommendPayload;
    const history = parseHistory(payload.history);
    const topK = parseTopK(payload.topK);
    const threshold = parseThreshold(payload.threshold);
    const useReranking = parseUseReranking(payload.useReranking);
    const useSimilarSearch = parseUseSimilarSearch(payload.useSimilarSearch);
    const stopWords = parseStopWords(payload.stopWords);
    const model = parseModel(payload.model);

    const extractionResult = useReranking
      ? await extractKeywords(history, model)
      : { keywords: [], amountRange: null };
    const stopWordsSet = new Set(stopWords.map((w) => w.toLowerCase()));
    const keywords = extractionResult.keywords.filter(
      (kw) => !stopWordsSet.has(kw.toLowerCase())
    );
    const amountRange = extractionResult.amountRange;

    // 類似キーワード検索モード
    if (useSimilarSearch && keywords.length > 0) {
      // プライマリキーワードから類似キーワードを生成
      const primaryKeyword = keywords[0]!;
      const similarKeywords = await generateSimilarKeywords(primaryKeyword, model);

      // 元のキーワード + 類似キーワードで検索
      const allSearchKeywords = [primaryKeyword, ...similarKeywords];

      // 並列検索実行
      const searchResults = await executeParallelSearches({
        keywords: allSearchKeywords,
        topK: Math.ceil(topK * 1.5), // 各クエリで多めに取得
        threshold,
        amountMin: amountRange?.min,
        amountMax: amountRange?.max,
      });

      // RRFでスコア統合
      const rrfResults = calculateRRFScores(searchResults);

      // 統計情報を計算
      let totalCandidates = 0;
      for (const results of searchResults.values()) {
        totalCandidates += results.length;
      }
      const searchStats: SearchStats = {
        queriesExecuted: searchResults.size,
        totalCandidates,
        uniqueResults: rrfResults.length,
      };

      // topK件に制限
      const finalMatches = rrfResults.slice(0, topK);

      return Response.json({
        ok: true,
        keywords,
        similarKeywords,
        amountRange,
        queryText: history,
        matches: finalMatches,
        searchStats,
      });
    }

    // 従来の検索モード
    const searchText = keywords.length > 0 ? keywords.join(" ") : history;
    const embedding = await generateTextEmbedding(searchText);
    const matches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK,
      threshold,
      amountMin: amountRange?.min,
      amountMax: amountRange?.max,
    });
    const primaryKeyword = keywords[0]?.trim() ?? "";
    const normalizeText = (value: string) => value.replace(/\s+/g, "");
    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasTerm = (text: string, term: string) => {
      if (!term) return false;
      const escaped = escapeRegExp(term);
      const pattern = `(^|[^\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}])${escaped}([^\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}]|$)`;
      const regex = new RegExp(pattern, "iu");
      return regex.test(text);
    };
    const normalizedPrimary = primaryKeyword ? normalizeText(primaryKeyword) : "";
    const normalizedKeywords = keywords
      .map((keyword) => normalizeText(keyword.trim()))
      .filter((keyword) => keyword.length > 0);

    const reranked = matches
      .map((match) => {
        const text = normalizeText(match.text ?? "");
        let boost = 0;
        if (normalizedPrimary) {
          if (hasTerm(text, normalizedPrimary)) {
            boost += 0.2;
          } else {
            boost -= 0.1;
          }
        }
        for (const keyword of normalizedKeywords) {
          if (keyword && hasTerm(text, keyword)) {
            boost += 0.03;
          }
        }
        return { ...match, score: Number(match.score) + boost };
      })
      .sort((a, b) => b.score - a.score);

    const finalMatches = useReranking ? reranked : matches;

    return Response.json({
      ok: true,
      keywords,
      amountRange,
      queryText: history,
      matches: finalMatches,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
