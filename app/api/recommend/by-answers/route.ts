import { assertOpenAIError } from "@/lib/image-text-search";
import {
  buildQueryText,
  parseThreshold,
  parseTopK,
  recommendByAnswers,
  type RecommendByAnswersInput,
} from "@/lib/recommend/by-answers-engine";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RecommendPayload = {
  budget?: string;
  category?: string;
  purpose?: string;
  delivery?: string[];
  allergen?: string;
  prefecture?: string;
  cityCode?: string;
  topK?: unknown;
  threshold?: unknown;
};

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
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
    const baseInput: RecommendByAnswersInput = {
      budget: payload.budget,
      category: payload.category,
      purpose: payload.purpose,
      delivery: payload.delivery,
      allergen: payload.allergen,
      prefecture: payload.prefecture,
      cityCode: payload.cityCode,
    };
    const queryText = buildQueryText(baseInput);
    if (!queryText) {
      throw new ApiError("回答が不足しています", 400);
    }

    const topK = parseTopK(payload.topK);
    const threshold = parseThreshold(payload.threshold);
    const result = await recommendByAnswers({
      ...baseInput,
      topK,
      threshold,
      queryText,
    });

    return Response.json({
      ok: true,
      queryText: result.queryText,
      budgetRange: result.budgetRange,
      matches: result.matches,
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
