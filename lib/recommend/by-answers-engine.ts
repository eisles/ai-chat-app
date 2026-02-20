import {
  generateTextEmbedding,
  searchTextEmbeddings,
  type SearchMatch,
} from "@/lib/image-text-search";
import { applyPersonalization } from "@/lib/recommend-personalization/rerank";
import { buildUserPreferenceProfile } from "@/lib/recommend-personalization/profile";

const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.3;

export type RecommendByAnswersInput = {
  budget?: string;
  category?: string;
  purpose?: string;
  delivery?: string[];
  allergen?: string;
  prefecture?: string;
  cityCode?: string;
  topK?: number;
  threshold?: number;
  queryText?: string;
  userId?: string;
  useLlmPersonalization?: boolean;
};

export type BudgetRange = {
  min: number | null;
  max: number | null;
};

export type RecommendByAnswersResult = {
  queryText: string;
  budgetRange: BudgetRange | null;
  matches: Array<
    SearchMatch & { personalBoost?: number; personalReasons?: string[] }
  >;
};

export function parseTopK(value: unknown, fallback = DEFAULT_TOP_K) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
}

export function parseThreshold(value: unknown, fallback = DEFAULT_THRESHOLD) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
}

export function buildQueryText(payload: RecommendByAnswersInput) {
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

type RawProduct = {
  categories?: Array<{
    category1_name?: string | null;
    category2_name?: string | null;
    category3_name?: string | null;
  }> | null;
  category?: string | null;
  category_name?: string | null;
  genre?: string | null;
  genre_name?: string | null;
  product_type?: string | null;
  item_type?: string | null;
  shipping_frozen_flag?: number | null;
  shipping_refrigerated_flag?: number | null;
  shipping_ordinary_flag?: number | null;
  delivery_hour_flag?: number | null;
  shipping_text?: string | null;
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

function coerceRaw(metadata: Record<string, unknown> | null): RawProduct | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") return null;
  return raw as RawProduct;
}

function normalizeCategoryText(value: string) {
  return value.trim().toLowerCase().replace(/[\s・/／、,]/g, "");
}

function collectCategoryCandidates(raw: RawProduct) {
  const candidates: string[] = [];
  if (raw.categories && raw.categories.length > 0) {
    raw.categories.forEach((entry) => {
      if (entry.category1_name) candidates.push(entry.category1_name);
      if (entry.category2_name) candidates.push(entry.category2_name);
      if (entry.category3_name) candidates.push(entry.category3_name);
    });
  }
  if (raw.category) candidates.push(raw.category);
  if (raw.category_name) candidates.push(raw.category_name);
  if (raw.genre) candidates.push(raw.genre);
  if (raw.genre_name) candidates.push(raw.genre_name);
  if (raw.product_type) candidates.push(raw.product_type);
  if (raw.item_type) candidates.push(raw.item_type);
  return candidates.filter((value) => value.trim().length > 0);
}

function matchesCategory(raw: RawProduct | null, category: string) {
  if (!raw) return false;
  const normalizedTarget = normalizeCategoryText(category);
  if (!normalizedTarget) return false;
  const candidates = collectCategoryCandidates(raw);
  if (candidates.length === 0) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeCategoryText(candidate);
    if (!normalizedCandidate) return false;
    return (
      normalizedCandidate.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedCandidate)
    );
  });
}

function matchesDelivery(raw: RawProduct | null, delivery: string) {
  if (!raw) return false;
  const shippingText = raw.shipping_text ?? "";
  if (delivery === "冷凍") {
    return raw.shipping_frozen_flag === 1 || shippingText.includes("冷凍");
  }
  if (delivery === "冷蔵") {
    return raw.shipping_refrigerated_flag === 1 || shippingText.includes("冷蔵");
  }
  if (delivery === "常温") {
    return raw.shipping_ordinary_flag === 1 || shippingText.includes("常温");
  }
  if (delivery === "早く届く") {
    return shippingText.includes("早") || shippingText.includes("即") || shippingText.includes("以内");
  }
  if (delivery === "日時指定できる") return raw.delivery_hour_flag === 1;
  return false;
}

export async function recommendByAnswers(
  input: RecommendByAnswersInput
): Promise<RecommendByAnswersResult> {
  const queryText = input.queryText ?? buildQueryText(input);
  const topK = input.topK ?? DEFAULT_TOP_K;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const embedding = await generateTextEmbedding(queryText);
  const rawMatches = await searchTextEmbeddings({
    embedding: embedding.vector,
    topK,
    threshold,
  });
  const budgetRange = parseBudgetRange(input.budget);
  const budgetFiltered = budgetRange
    ? rawMatches.filter((match) => {
        const amount = coerceAmount(match.metadata ?? null);
        return amount !== null && withinBudget(amount, budgetRange);
      })
    : rawMatches;
  const categoryFiltered =
    input.category && input.category.trim().length > 0
      ? budgetFiltered.filter((match) =>
          matchesCategory(coerceRaw(match.metadata ?? null), input.category ?? "")
        )
      : budgetFiltered;
  const deliveryFiltered =
    input.delivery && input.delivery.length > 0
      ? categoryFiltered.filter((match) => {
          const raw = coerceRaw(match.metadata ?? null);
          return input.delivery?.every((entry) => matchesDelivery(raw, entry));
        })
      : categoryFiltered;
  let matches: RecommendByAnswersResult["matches"] = deliveryFiltered;
  if (input.userId) {
    try {
      const profile = await buildUserPreferenceProfile(input.userId, {
        useLlmPersonalization: input.useLlmPersonalization === true,
      });
      if (profile) {
        matches = applyPersonalization(deliveryFiltered, profile);
      }
    } catch {
      matches = deliveryFiltered;
    }
  }

  return {
    queryText,
    budgetRange,
    matches,
  };
}
