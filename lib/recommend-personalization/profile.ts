import { generatePreferenceKeywordsByLlm } from "@/lib/recommend-personalization/llm-keywords";
import {
  getProductSignals,
  getRecentClicksByUser,
  type ClickEvent,
  type ProductSignal,
} from "@/lib/recommend-personalization/repository";

const DEFAULT_RECENT_CLICK_LIMIT = 30;
const DEFAULT_LLM_TEXT_LIMIT = 10;

export type UserPreferenceProfile = {
  categoryWeights: Record<string, number>;
  keywordWeights: Record<string, number>;
  recentProductIds: string[];
  preferredAmountRange: {
    min: number;
    max: number;
    sampleCount: number;
  } | null;
};

export type BuildProfileOptions = {
  useLlmPersonalization: boolean;
  recentClickLimit?: number;
};

type RawProduct = {
  name?: string | null;
  amount?: number | string | null;
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
};

type WeightedEntry = {
  label: string;
  weight: number;
};

function coerceRaw(metadata: Record<string, unknown> | null): RawProduct | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") return null;
  return raw as RawProduct;
}

function collectCategoryCandidates(raw: RawProduct): string[] {
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
  return candidates.map((value) => value.trim()).filter((value) => value.length > 0);
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function splitKeywordsFromText(text: string): string[] {
  return text
    .split(/[\s、,。・/／()（）\[\]【】\n\r\t]+/g)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);
}

function extractKeywordsFromQueryText(queryText: string): string[] {
  const keywords: string[] = [];
  queryText.split(/\n+/).forEach((line) => {
    const [label, value] = line.split(/[:：]/, 2);
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      keywords.push(trimmed);
    } else if (label && label.trim().length > 0) {
      keywords.push(label.trim());
    }
  });
  return keywords;
}

function addWeight(map: Record<string, number>, entry: string, weight = 1) {
  const key = normalizeKeyword(entry);
  if (!key) return;
  map[key] = (map[key] ?? 0) + weight;
}

function mergeWeightedEntries(
  map: Record<string, number>,
  entries: WeightedEntry[]
): Record<string, number> {
  const merged = { ...map };
  entries.forEach((entry) => {
    addWeight(merged, entry.label, entry.weight);
  });
  return merged;
}

function collectKeywordsFromSignal(signal: ProductSignal): string[] {
  const keywords = new Set<string>();
  const raw = coerceRaw(signal.metadata);
  if (raw?.name) {
    splitKeywordsFromText(raw.name).forEach((value) => keywords.add(value));
  }
  if (raw) {
    collectCategoryCandidates(raw).forEach((value) => keywords.add(value));
  }
  splitKeywordsFromText(signal.text).forEach((value) => keywords.add(value));
  return Array.from(keywords);
}

function collectKeywordsFromClick(click: ClickEvent): string[] {
  const metadata = click.metadata;
  if (!metadata || typeof metadata !== "object") return [];
  const queryText = metadata.queryText;
  if (typeof queryText === "string" && queryText.trim().length > 0) {
    return extractKeywordsFromQueryText(queryText);
  }
  return [];
}

function coerceAmount(raw: RawProduct | null): number | null {
  if (!raw) return null;
  const value = raw.amount;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function buildPreferredAmountRange(
  signals: ProductSignal[]
): UserPreferenceProfile["preferredAmountRange"] {
  const amounts = signals
    .map((signal) => coerceAmount(coerceRaw(signal.metadata)))
    .filter((value): value is number => value !== null);

  if (amounts.length === 0) return null;

  const sorted = [...amounts].sort((a, b) => a - b);
  const baseMin =
    sorted.length < 4
      ? sorted[0]
      : sorted[Math.floor((sorted.length - 1) * 0.25)];
  const baseMax =
    sorted.length < 4
      ? sorted[sorted.length - 1]
      : sorted[Math.floor((sorted.length - 1) * 0.75)];
  const min = Math.max(1, Math.floor(baseMin * 0.85));
  const max = Math.max(min, Math.ceil(baseMax * 1.15));

  return {
    min,
    max,
    sampleCount: sorted.length,
  };
}

function collectCategoryWeights(signals: ProductSignal[]): Record<string, number> {
  const weights: Record<string, number> = {};
  signals.forEach((signal) => {
    const raw = coerceRaw(signal.metadata);
    if (!raw) return;
    collectCategoryCandidates(raw).forEach((value) => {
      addWeight(weights, value, 1);
    });
  });
  return weights;
}

function collectKeywordWeights(
  signals: ProductSignal[],
  clicks: ClickEvent[]
): Record<string, number> {
  const weights: Record<string, number> = {};
  signals.forEach((signal) => {
    collectKeywordsFromSignal(signal).forEach((value) => addWeight(weights, value, 1));
  });
  clicks.forEach((click) => {
    collectKeywordsFromClick(click).forEach((value) => addWeight(weights, value, 1));
  });
  return weights;
}

function buildRecentProductIds(clicks: ClickEvent[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  clicks.forEach((click) => {
    if (!seen.has(click.productId)) {
      seen.add(click.productId);
      ordered.push(click.productId);
    }
  });
  return ordered;
}

function collectLlmTexts(signals: ProductSignal[], clicks: ClickEvent[]): string[] {
  const texts = signals
    .map((signal) => signal.text)
    .filter((value) => value.trim().length > 0);
  const extra = clicks
    .map((click) => click.metadata?.queryText)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...texts, ...extra].slice(0, DEFAULT_LLM_TEXT_LIMIT);
}

export async function buildUserPreferenceProfile(
  userId: string,
  options: BuildProfileOptions
): Promise<UserPreferenceProfile | null> {
  try {
    const limit = options.recentClickLimit ?? DEFAULT_RECENT_CLICK_LIMIT;
    const clicks = await getRecentClicksByUser(userId, limit);
    if (clicks.length === 0) return null;

    const productIds = buildRecentProductIds(clicks);
    const signals = await getProductSignals(productIds);

    const categoryWeights = collectCategoryWeights(signals);
    const keywordWeights = collectKeywordWeights(signals, clicks);
    const baseProfile = {
      categoryWeights,
      keywordWeights,
      recentProductIds: productIds,
      preferredAmountRange: buildPreferredAmountRange(signals),
    };

    if (options.useLlmPersonalization) {
      const llmTexts = collectLlmTexts(signals, clicks);
      if (llmTexts.length > 0) {
        try {
          const llmKeywords = await generatePreferenceKeywordsByLlm(llmTexts);
          const weightedEntries = llmKeywords.map((label) => ({ label, weight: 2 }));
          const merged = mergeWeightedEntries(keywordWeights, weightedEntries);
          return {
            categoryWeights,
            keywordWeights: merged,
            recentProductIds: productIds,
            preferredAmountRange: baseProfile.preferredAmountRange,
          };
        } catch {
          return baseProfile;
        }
      }
    }

    return baseProfile;
  } catch {
    return null;
  }
}
