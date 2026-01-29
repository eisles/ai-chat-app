import {
  assertOpenAIError,
  generateTextEmbedding,
  searchTextEmbeddings,
} from "@/lib/image-text-search";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.3;

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

function buildQueryText(payload: RecommendPayload) {
  const parts: string[] = [];
  if (payload.category) {
    parts.push(`カテゴリ: ${payload.category}`);
    parts.push(`カテゴリ優先: ${payload.category}`);
    parts.push(`カテゴリ強調: ${payload.category}`);
  }
  if (payload.purpose) parts.push(`用途: ${payload.purpose}`);
  if (payload.delivery && payload.delivery.length > 0) {
    parts.push(`配送条件: ${payload.delivery.join(" / ")}`);
  }
  if (payload.allergen && payload.allergen !== "なし") {
    parts.push(`アレルゲン配慮: ${payload.allergen}`);
  }
  if (payload.prefecture) parts.push(`都道府県: ${payload.prefecture}`);
  if (payload.cityCode) parts.push(`市町村コード: ${payload.cityCode}`);
  return parts.join("\n");
}

type BudgetRange = {
  min: number | null;
  max: number | null;
};

function parseBudgetRange(budget: string | undefined) {
  if (!budget) {
    return null;
  }
  if (budget === "〜5,000円") return { min: null, max: 5000 };
  if (budget === "5,001〜10,000円") return { min: 5001, max: 10000 };
  if (budget === "10,001〜20,000円") return { min: 10001, max: 20000 };
  if (budget === "20,001〜30,000円") return { min: 20001, max: 30000 };
  if (budget === "30,001円以上") return { min: 30001, max: null };
  return null;
}

function withinBudget(amount: number, range: BudgetRange) {
  if (range.min !== null && amount < range.min) return false;
  if (range.max !== null && amount > range.max) return false;
  return true;
}

function coerceAmount(metadata: Record<string, unknown> | null) {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") return null;
  const amount = (raw as { amount?: unknown }).amount;
  if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  if (typeof amount === "string") {
    const parsed = Number(amount.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type RawProduct = {
  categories?: Array<{
    category1_name?: string | null;
    category2_name?: string | null;
    category3_name?: string | null;
  }> | null;
  shipping_frozen_flag?: number | null;
  shipping_refrigerated_flag?: number | null;
  shipping_ordinary_flag?: number | null;
  delivery_hour_flag?: number | null;
  shipping_text?: string | null;
};

function coerceRaw(metadata: Record<string, unknown> | null): RawProduct | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") return null;
  return raw as RawProduct;
}

function matchesCategory(raw: RawProduct | null, category: string) {
  if (!raw?.categories || raw.categories.length === 0) return false;
  return raw.categories.some((entry) => {
    const names = [
      entry.category1_name,
      entry.category2_name,
      entry.category3_name,
    ]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    return names.includes(category);
  });
}

function matchesDelivery(raw: RawProduct | null, delivery: string) {
  if (!raw) return false;
  const shippingText = raw.shipping_text ?? "";
  if (delivery === "冷凍") return raw.shipping_frozen_flag === 1 || shippingText.includes("冷凍");
  if (delivery === "冷蔵")
    return raw.shipping_refrigerated_flag === 1 || shippingText.includes("冷蔵");
  if (delivery === "常温")
    return raw.shipping_ordinary_flag === 1 || shippingText.includes("常温");
  if (delivery === "早く届く")
    return shippingText.includes("早") || shippingText.includes("即") || shippingText.includes("以内");
  if (delivery === "日時指定できる") return raw.delivery_hour_flag === 1;
  return false;
}

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
    const queryText = buildQueryText(payload);
    if (!queryText) {
      throw new ApiError("回答が不足しています", 400);
    }

    const topK = parseTopK(payload.topK);
    const threshold = parseThreshold(payload.threshold);
    const embedding = await generateTextEmbedding(queryText);
    const rawMatches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK,
      threshold,
    });
    const budgetRange = parseBudgetRange(payload.budget);
    const budgetFiltered = budgetRange
      ? rawMatches.filter((match) => {
          const amount = coerceAmount(match.metadata ?? null);
          return amount !== null && withinBudget(amount, budgetRange);
        })
      : rawMatches;
    const categoryFiltered =
      payload.category && payload.category.trim().length > 0
        ? budgetFiltered.filter((match) =>
            matchesCategory(coerceRaw(match.metadata ?? null), payload.category ?? ""),
          )
        : budgetFiltered;
    const deliveryFiltered =
      payload.delivery && payload.delivery.length > 0
        ? categoryFiltered.filter((match) => {
            const raw = coerceRaw(match.metadata ?? null);
            return payload.delivery?.every((entry) => matchesDelivery(raw, entry));
          })
        : categoryFiltered;
    const matches = deliveryFiltered;

    return Response.json({
      ok: true,
      queryText,
      budgetRange,
      matches,
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
