import type { SearchMatch } from "@/lib/image-text-search";
import type { UserPreferenceProfile } from "@/lib/recommend-personalization/profile";

const PERSONAL_BOOST = {
  categoryMatch: 0.12,
  keywordMatchMax: 0.1,
  recentClickSameProductPenalty: -0.05,
};

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
  name?: string | null;
};

type BoostResult = {
  value: number;
  reasons: string[];
};

type CategoryMatch = {
  label: string;
  weight: number;
};

function coerceRaw(metadata: Record<string, unknown> | null): RawProduct | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") return null;
  return raw as RawProduct;
}

function normalizeCategoryText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s・/／、,]/g, "");
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

function extractMatchText(match: SearchMatch): string {
  const raw = coerceRaw(match.metadata ?? null);
  const parts: string[] = [match.text];
  if (raw?.name) parts.push(raw.name);
  return parts.join(" ");
}

function findBestCategoryMatch(
  matchCategories: string[],
  profileCategories: Array<[string, number]>
): CategoryMatch | null {
  if (matchCategories.length === 0 || profileCategories.length === 0) return null;
  const normalizedMatch = matchCategories.map((value) => normalizeCategoryText(value));

  let best: CategoryMatch | null = null;
  profileCategories.forEach(([label, weight]) => {
    const normalizedProfile = normalizeCategoryText(label);
    if (!normalizedProfile) return;
    const matched = normalizedMatch.some((candidate) => {
      if (!candidate) return false;
      return (
        candidate.includes(normalizedProfile) || normalizedProfile.includes(candidate)
      );
    });
    if (!matched) return;
    if (!best || weight > best.weight) {
      best = { label, weight };
    }
  });

  return best;
}

function findBestKeywordMatch(
  matchText: string,
  profileKeywords: Array<[string, number]>
): CategoryMatch | null {
  if (!matchText.trim() || profileKeywords.length === 0) return null;
  const normalizedText = matchText.toLowerCase();

  let best: CategoryMatch | null = null;
  profileKeywords.forEach(([label, weight]) => {
    const keyword = label.trim().toLowerCase();
    if (!keyword) return;
    if (!normalizedText.includes(keyword)) return;
    if (!best || weight > best.weight) {
      best = { label, weight };
    }
  });

  return best;
}

function calcCategoryBoost(
  match: SearchMatch,
  profile: UserPreferenceProfile
): BoostResult {
  const raw = coerceRaw(match.metadata ?? null);
  if (!raw) return { value: 0, reasons: [] };
  const categories = collectCategoryCandidates(raw);
  if (categories.length === 0) return { value: 0, reasons: [] };

  const entries = Object.entries(profile.categoryWeights);
  if (entries.length === 0) return { value: 0, reasons: [] };
  const maxWeight = Math.max(...entries.map(([, weight]) => weight));
  const best = findBestCategoryMatch(categories, entries);
  if (!best) return { value: 0, reasons: [] };

  const ratio = maxWeight > 0 ? best.weight / maxWeight : 0;
  const boost = PERSONAL_BOOST.categoryMatch * ratio;
  if (boost <= 0) return { value: 0, reasons: [] };

  return {
    value: boost,
    reasons: [`最近のクリック傾向（${best.label}）に一致`],
  };
}

function calcKeywordBoost(
  match: SearchMatch,
  profile: UserPreferenceProfile
): BoostResult {
  const entries = Object.entries(profile.keywordWeights);
  if (entries.length === 0) return { value: 0, reasons: [] };
  const matchText = extractMatchText(match);
  const best = findBestKeywordMatch(matchText, entries);
  if (!best) return { value: 0, reasons: [] };

  const maxWeight = Math.max(...entries.map(([, weight]) => weight));
  const ratio = maxWeight > 0 ? best.weight / maxWeight : 0;
  const boost = Math.min(PERSONAL_BOOST.keywordMatchMax, ratio * PERSONAL_BOOST.keywordMatchMax);

  if (boost <= 0) return { value: 0, reasons: [] };

  return {
    value: boost,
    reasons: [`よく見ているキーワード「${best.label}」に一致`],
  };
}

export function applyPersonalization(
  matches: SearchMatch[],
  profile: UserPreferenceProfile | null
): SearchMatch[] {
  if (!profile) return matches;
  const recentSet = new Set(profile.recentProductIds);

  const scored = matches.map((match, index) => {
    const categoryBoost = calcCategoryBoost(match, profile);
    const keywordBoost = calcKeywordBoost(match, profile);
    const penalty = recentSet.has(match.productId)
      ? PERSONAL_BOOST.recentClickSameProductPenalty
      : 0;
    const boostValue = categoryBoost.value + keywordBoost.value + penalty;
    const reasons = [...categoryBoost.reasons, ...keywordBoost.reasons];
    return {
      index,
      match: {
        ...match,
        score: match.score + boostValue,
        personalBoost: boostValue,
        personalReasons: reasons,
      } as SearchMatch & {
        personalBoost: number;
        personalReasons: string[];
      },
    };
  });

  scored.sort((a, b) => {
    if (b.match.score !== a.match.score) {
      return b.match.score - a.match.score;
    }
    return a.index - b.index;
  });

  return scored.map((entry) => entry.match);
}
