import { assertOpenAIError } from "@/lib/image-text-search";
import { createCompletion, LLMProviderError } from "@/lib/llm-providers";
import {
  parseThreshold,
  parseTopK,
  recommendByAnswers,
  type RecommendByAnswersResult,
} from "@/lib/recommend/by-answers-engine";
import {
  buildUserPreferenceProfile,
  type UserPreferenceProfile,
} from "@/lib/recommend-personalization/profile";
import type { ConversationSession } from "@/lib/recommend-conversation/types";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.35;
const DEFAULT_AGENT_LIMIT = 3;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Payload = {
  session?: unknown;
  topK?: unknown;
  threshold?: unknown;
  userId?: unknown;
  useLlmPersonalization?: unknown;
};

type AgentMatch = RecommendByAnswersResult["matches"][number] & {
  agentReason: string;
};

type AgentSearchStrategy =
  | "history_only"
  | "current_conditions_fallback"
  | "current_conditions_only";

type AgentExtractionSummary = {
  searchStrategy: AgentSearchStrategy;
  currentConditions: string[];
  personalizationSignals: string[];
  rerankRules: string[];
  personalizedMatchCount: number;
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function parseUserId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("userIdが必要です", 400);
  }
  const trimmed = value.trim();
  if (!UUID_V4_REGEX.test(trimmed)) {
    throw new ApiError("userIdはUUID v4形式で指定してください", 400);
  }
  return trimmed;
}

function parseSessionSlots(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as ConversationSession["slots"];
  }
  const session = value as ConversationSession;
  if (!session.slots || typeof session.slots !== "object") {
    return {} as ConversationSession["slots"];
  }
  return session.slots;
}

function parseUseLlmPersonalization(value: unknown): boolean {
  return value === true;
}

function buildAgentReason(match: RecommendByAnswersResult["matches"][number]): string {
  if (match.personalReasons && match.personalReasons.length > 0) {
    return match.personalReasons[0];
  }
  if ((match.personalBoost ?? 0) > 0) {
    return "クリック履歴に近い商品です";
  }
  return "現在の条件との一致度が高い商品です";
}

function selectAgentMatches(
  matches: RecommendByAnswersResult["matches"],
  limit = DEFAULT_AGENT_LIMIT
): AgentMatch[] {
  const withIndex = matches.map((match, index) => ({ match, index }));
  withIndex.sort((a, b) => {
    const aBoost = a.match.personalBoost ?? 0;
    const bBoost = b.match.personalBoost ?? 0;
    if (bBoost !== aBoost) return bBoost - aBoost;
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return a.index - b.index;
  });

  const seen = new Set<string>();
  const selected: AgentMatch[] = [];
  for (const entry of withIndex) {
    if (seen.has(entry.match.productId)) continue;
    seen.add(entry.match.productId);
    selected.push({
      ...entry.match,
      agentReason: buildAgentReason(entry.match),
    });
    if (selected.length >= limit) break;
  }

  return selected;
}

function buildFallbackAgentMessage(
  matches: AgentMatch[],
  strategy: AgentSearchStrategy
): string {
  if (matches.length === 0) {
    return "条件に合う候補が見つかりませんでした。条件を少し広げて再実行してください。";
  }
  if (strategy === "history_only") {
    return `クリック履歴を優先して${matches.length}件を提案します。`;
  }
  if (strategy === "current_conditions_fallback") {
    return `クリック履歴では候補が不足したため、現在の条件を使って${matches.length}件を提案します。`;
  }
  const hasPersonal = matches.some((match) => (match.personalBoost ?? 0) > 0);
  if (hasPersonal) {
    return `クリック履歴と現在の条件をもとに${matches.length}件を提案します。`;
  }
  return `現在の条件を優先して${matches.length}件を提案します。`;
}

function buildAgentPrompt(matches: AgentMatch[]): string {
  const lines = matches.map((match, index) => {
    const name =
      typeof match.metadata?.raw === "object" &&
      match.metadata?.raw &&
      typeof (match.metadata.raw as Record<string, unknown>).name === "string"
        ? ((match.metadata.raw as Record<string, unknown>).name as string)
        : `商品ID: ${match.productId}`;
    return `${index + 1}. ${name} / 理由: ${match.agentReason}`;
  });
  return lines.join("\n");
}

function formatAmountRange(min: number, max: number): string {
  return `${min.toLocaleString("ja-JP")}〜${max.toLocaleString("ja-JP")}円`;
}

function pickTopWeightedLabels(
  weights: Record<string, number>,
  limit: number
): string[] {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, limit)
    .map(([label]) => label);
}

function buildHistoryQueryText(profile: UserPreferenceProfile | null): string | null {
  if (!profile) return null;
  const categories = pickTopWeightedLabels(profile.categoryWeights, 3);
  const keywords = pickTopWeightedLabels(profile.keywordWeights, 5);

  const lines: string[] = [];
  if (categories.length > 0) {
    lines.push(`履歴カテゴリ: ${categories.join(" / ")}`);
  }
  if (keywords.length > 0) {
    lines.push(`履歴キーワード: ${keywords.join(" / ")}`);
  }
  if (lines.length === 0) return null;
  return lines.join("\n");
}

function withinAmountRange(
  value: number | null | undefined,
  min: number,
  max: number
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value >= min && value <= max;
}

function buildCurrentConditions(slots: ConversationSession["slots"]): string[] {
  const conditions: string[] = [];
  if (slots.purpose) conditions.push(`用途: ${slots.purpose}`);
  if (slots.budget) conditions.push(`予算: ${slots.budget}`);
  if (slots.category) conditions.push(`カテゴリ: ${slots.category}`);
  if (slots.delivery && slots.delivery.length > 0) {
    conditions.push(`配送希望: ${slots.delivery.join(" / ")}`);
  }
  if (slots.allergen) conditions.push(`アレルゲン: ${slots.allergen}`);
  if (slots.prefecture) conditions.push(`都道府県: ${slots.prefecture}`);
  if (slots.cityCode) conditions.push(`市町村コード: ${slots.cityCode}`);
  if (conditions.length === 0) {
    return ["会話で入力された現在条件（用途・予算・カテゴリ等）"];
  }
  return conditions;
}

function buildPersonalizationSignals(
  profile: UserPreferenceProfile | null,
  finalUseLlm: boolean,
  amountFilterApplied: boolean
): string[] {
  if (!profile) {
    return ["クリック履歴がないため、現在条件のみで候補を抽出"];
  }

  const signals: string[] = [];
  const topCategories = pickTopWeightedLabels(profile.categoryWeights, 3);
  const topKeywords = pickTopWeightedLabels(profile.keywordWeights, 5);

  signals.push(`最近クリックした商品数: ${profile.recentProductIds.length}件`);
  if (topCategories.length > 0) {
    signals.push(`カテゴリ傾向: ${topCategories.join(" / ")}`);
  }
  if (topKeywords.length > 0) {
    signals.push(`キーワード傾向: ${topKeywords.join(" / ")}`);
  }
  if (profile.preferredAmountRange) {
    signals.push(
      `履歴金額レンジ: ${formatAmountRange(
        profile.preferredAmountRange.min,
        profile.preferredAmountRange.max
      )}${amountFilterApplied ? "（適用）" : "（未適用）"}`
    );
  } else {
    signals.push("履歴金額レンジ: データなし");
  }
  signals.push(
    finalUseLlm
      ? "LLMキーワード補強: 有効（env=true かつ UIでON）"
      : "LLMキーワード補強: 無効（envかUIのいずれかがOFF）"
  );
  return signals;
}

function buildAgentExtractionSummary(params: {
  searchStrategy: AgentSearchStrategy;
  slots: ConversationSession["slots"];
  profile: UserPreferenceProfile | null;
  finalUseLlm: boolean;
  amountFilterApplied: boolean;
  agentMatches: AgentMatch[];
}): AgentExtractionSummary {
  const personalizedMatchCount = params.agentMatches.filter(
    (match) => (match.personalBoost ?? 0) > 0
  ).length;
  return {
    searchStrategy: params.searchStrategy,
    currentConditions: buildCurrentConditions(params.slots),
    personalizationSignals: buildPersonalizationSignals(
      params.profile,
      params.finalUseLlm,
      params.amountFilterApplied
    ),
    rerankRules: [
      "カテゴリ一致を最大 +0.12 で加点",
      "キーワード一致を最大 +0.10 で加点",
      "直近クリックと同一商品は -0.05 で減点",
      "最終スコア順で上位候補を抽出",
    ],
    personalizedMatchCount,
  };
}

async function buildAgentMessageByLlm(matches: AgentMatch[]): Promise<string | null> {
  if (matches.length === 0) return null;
  try {
    const response = await createCompletion({
      model: process.env.RECOMMEND_PERSONALIZATION_LLM_MODEL ?? "openai:gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "以下の候補からユーザー向けの提案メッセージを日本語で1文だけ作ってください。JSONは不要。",
        },
        {
          role: "user",
          content: buildAgentPrompt(matches),
        },
      ],
      temperature: 0.3,
      maxTokens: 120,
    });

    const message = response.content.trim();
    return message.length > 0 ? message : null;
  } catch {
    return null;
  }
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
    const body = (await req.json()) as Payload;
    const userId = parseUserId(body.userId);
    const slots = parseSessionSlots(body.session);
    const topK = parseTopK(body.topK, DEFAULT_TOP_K);
    const threshold = parseThreshold(body.threshold, DEFAULT_THRESHOLD);

    const requestUseLlm = parseUseLlmPersonalization(body.useLlmPersonalization);
    const envEnabled = process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED === "true";
    const finalUseLlm = envEnabled && requestUseLlm;
    const profile = await buildUserPreferenceProfile(userId, {
      useLlmPersonalization: finalUseLlm,
    });
    const historyQueryText = buildHistoryQueryText(profile);

    let result: RecommendByAnswersResult;
    let strategy: AgentSearchStrategy = "current_conditions_only";
    let amountFilterApplied = false;

    if (profile && historyQueryText) {
      const historyResult = await recommendByAnswers({
        queryText: historyQueryText,
        topK,
        threshold,
        userId,
        useLlmPersonalization: finalUseLlm,
      });

      let historyMatches = historyResult.matches;
      const preferredAmountRange = profile.preferredAmountRange;
      if (preferredAmountRange) {
        amountFilterApplied = true;
        historyMatches = historyMatches.filter((match) =>
          withinAmountRange(
            match.amount,
            preferredAmountRange.min,
            preferredAmountRange.max
          )
        );
      }

      if (historyMatches.length > 0) {
        strategy = "history_only";
        result = { ...historyResult, matches: historyMatches };
      } else {
        strategy = "current_conditions_fallback";
        result = await recommendByAnswers({
          budget: slots.budget,
          category: slots.category,
          purpose: slots.purpose,
          delivery: slots.delivery,
          allergen: slots.allergen,
          prefecture: slots.prefecture,
          cityCode: slots.cityCode,
          topK,
          threshold,
          userId,
          useLlmPersonalization: finalUseLlm,
        });
      }
    } else {
      result = await recommendByAnswers({
        budget: slots.budget,
        category: slots.category,
        purpose: slots.purpose,
        delivery: slots.delivery,
        allergen: slots.allergen,
        prefecture: slots.prefecture,
        cityCode: slots.cityCode,
        topK,
        threshold,
        userId,
        useLlmPersonalization: finalUseLlm,
      });
    }

    const agentMatches = selectAgentMatches(result.matches, DEFAULT_AGENT_LIMIT);
    const llmMessage = finalUseLlm
      ? await buildAgentMessageByLlm(agentMatches)
      : null;
    const agentExtractionSummary = buildAgentExtractionSummary({
      searchStrategy: strategy,
      slots,
      profile,
      finalUseLlm,
      amountFilterApplied,
      agentMatches,
    });

    return Response.json({
      ok: true,
      finalUseLlm,
      strategy,
      queryText: result.queryText,
      agentMessage: llmMessage ?? buildFallbackAgentMessage(agentMatches, strategy),
      agentMatches,
      agentExtractionSummary,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
