import { assertOpenAIError } from "@/lib/image-text-search";
import { LLMProviderError } from "@/lib/llm-providers";
import {
  parseThreshold,
  parseTopK,
  recommendByAnswers,
  type RecommendByAnswersDebugInfo,
  type RecommendByAnswersInput,
  type RecommendByAnswersProgressStage,
  type RecommendByAnswersResult,
} from "@/lib/recommend/by-answers-engine";
import { insertRecommendSearchEvent } from "@/lib/recommend-personalization/repository";
import { DEFAULT_QUESTION_SET } from "@/lib/recommend-assistant-config/default-config";
import { getPublishedQuestionSet } from "@/lib/recommend-assistant-config/repository";
import type { AssistantStepConfig } from "@/lib/recommend-assistant-config/types";
import { getRecommendCategoryQuickReplies } from "@/lib/recommend/category-candidates";
import { extractSlots } from "@/lib/recommend-conversation/extract";
import {
  buildNextQuestion,
  getQuestionQuickReplies,
  getQuestionState,
  mergeSlots,
  sanitizeAskedKeys,
} from "@/lib/recommend-conversation/session";
import type {
  ConversationSession,
  ConversationStepKey,
  SlotState,
} from "@/lib/recommend-conversation/types";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.35;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Payload = {
  message?: unknown;
  session?: ConversationSession;
  topK?: unknown;
  threshold?: unknown;
  allowCategoryFallback?: unknown;
  selectedStepKey?: unknown;
  selectedValue?: unknown;
  userId?: unknown;
  useLlmPersonalization?: unknown;
  streamProgress?: unknown;
};

type DebugTiming = {
  name: string;
  durationMs: number;
};

type DebugInfo = {
  actionPath: "ask" | "recommend";
  extractionSkipped: boolean;
  selectedStepKey: ConversationStepKey | null;
  totalDurationMs: number;
  timings: DebugTiming[];
  recommendation?: RecommendByAnswersDebugInfo;
};

type ConversationProgressStage =
  | "load_question_set"
  | "extract_slots"
  | "load_category_quick_replies"
  | "recommend_build_query_text"
  | "recommend_generate_text_embedding"
  | "recommend_search_text_embeddings"
  | "recommend_filter_budget"
  | "recommend_filter_category"
  | "recommend_filter_delivery"
  | "recommend_build_user_preference_profile"
  | "recommend_apply_personalization"
  | "recommend_complete"
  | "record_fallback_event";

type AskResponseBody = {
  ok: true;
  action: "ask";
  session: ConversationSession;
  missingKeys: ConversationStepKey[];
  nextQuestionKey: ConversationStepKey;
  quickReplies: string[];
  assistantMessage: string;
  debugInfo: DebugInfo;
};

type RecommendResponseBody = {
  ok: true;
  action: "recommend";
  session: ConversationSession;
  assistantMessage: string;
  queryText: string;
  budgetRange: RecommendByAnswersResult["budgetRange"];
  fallbackInfo: RecommendByAnswersResult["fallbackInfo"];
  matches: RecommendByAnswersResult["matches"];
  debugInfo: DebugInfo;
};

type ConversationResponseBody = AskResponseBody | RecommendResponseBody;

function isOptionalStep(
  stepKey: ConversationStepKey | null,
  steps: AssistantStepConfig[]
): stepKey is "delivery" | "additional" {
  if (!stepKey) return false;
  const matched = steps.find((step) => step.key === stepKey);
  if (matched) return matched.optional;
  return stepKey === "delivery" || stepKey === "additional";
}

function parseMessage(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("message is required", 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError("message is required", 400);
  }
  return trimmed;
}

function parseSelectedAnswer(stepKey: unknown, selectedValue: unknown) {
  if (typeof stepKey !== "string" || typeof selectedValue !== "string") {
    return null;
  }
  const value = selectedValue.trim();
  if (!value) {
    return null;
  }

  const validStepKeys: ConversationStepKey[] = [
    "purpose",
    "budget",
    "category",
    "delivery",
    "additional",
  ];
  if (!validStepKeys.includes(stepKey as ConversationStepKey)) {
    return null;
  }
  return {
    stepKey: stepKey as ConversationStepKey,
    value,
  };
}

function shouldSkipSlotExtraction(selectedAnswer: {
  stepKey: ConversationStepKey;
  value: string;
} | null) {
  return selectedAnswer !== null;
}

async function measureStep<T>(
  timings: DebugTiming[],
  name: string,
  runner: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const result = await runner();
  timings.push({
    name,
    durationMs: Date.now() - startedAt,
  });
  return result;
}

function parseUserId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("userIdが不正です", 400);
  }
  const trimmed = value.trim();
  if (!UUID_V4_REGEX.test(trimmed)) {
    throw new ApiError("userIdはUUID v4形式で指定してください", 400);
  }
  return trimmed;
}

function parseUseLlmPersonalization(value: unknown): boolean {
  return value === true;
}

function parseStreamProgress(value: unknown): boolean {
  return value === true;
}

function parseAllowCategoryFallback(value: unknown): boolean {
  return value !== false;
}

function mapRecommendProgressStage(
  stage: RecommendByAnswersProgressStage
): ConversationProgressStage {
  switch (stage) {
    case "build_query_text":
      return "recommend_build_query_text";
    case "generate_text_embedding":
      return "recommend_generate_text_embedding";
    case "search_text_embeddings":
      return "recommend_search_text_embeddings";
    case "filter_budget":
      return "recommend_filter_budget";
    case "filter_category":
      return "recommend_filter_category";
    case "filter_delivery":
      return "recommend_filter_delivery";
    case "build_user_preference_profile":
      return "recommend_build_user_preference_profile";
    case "apply_personalization":
      return "recommend_apply_personalization";
    case "complete":
      return "recommend_complete";
  }
}

function getProgressLabel(stage: ConversationProgressStage): string {
  switch (stage) {
    case "load_question_set":
      return "質問セットを読み込んでいます";
    case "extract_slots":
      return "入力内容から条件を抽出しています";
    case "load_category_quick_replies":
      return "カテゴリ候補を集計しています";
    case "recommend_build_query_text":
      return "検索クエリを組み立てています";
    case "recommend_generate_text_embedding":
      return "検索用の埋め込みを生成しています";
    case "recommend_search_text_embeddings":
      return "ベクトル検索で候補を探しています";
    case "recommend_filter_budget":
      return "予算条件で候補を絞り込んでいます";
    case "recommend_filter_category":
      return "カテゴリ条件を確認しています";
    case "recommend_filter_delivery":
      return "配送条件を確認しています";
    case "recommend_build_user_preference_profile":
      return "クリック履歴から嗜好プロファイルを作成しています";
    case "recommend_apply_personalization":
      return "候補の並び順を個人化しています";
    case "recommend_complete":
      return "結果をまとめています";
    case "record_fallback_event":
      return "条件緩和の記録を保存しています";
  }
}

async function recordFallbackAppliedEvent(params: {
  userId: string | null;
  topK: number;
  threshold: number;
  slots: SlotState;
  allowCategoryFallback: boolean;
  fallbackInfo: {
    reason: "category_no_match" | null;
    relaxedConditions: string[];
    strictMatchCount: number;
    relaxedMatchCount: number;
  };
}) {
  try {
    await insertRecommendSearchEvent({
      userId: params.userId,
      source: "recommend-assistant",
      eventType: "recommend_fallback_applied",
      metadata: {
        reason: params.fallbackInfo.reason,
        relaxedConditions: params.fallbackInfo.relaxedConditions,
        strictMatchCount: params.fallbackInfo.strictMatchCount,
        relaxedMatchCount: params.fallbackInfo.relaxedMatchCount,
        topK: params.topK,
        threshold: params.threshold,
        slots: params.slots,
        allowCategoryFallback: params.allowCategoryFallback,
      },
    });
  } catch {
    // イベント記録失敗は推薦APIの失敗にしない
  }
}

function applySelectedAnswer(extracted: SlotState, stepKey: ConversationStepKey, value: string) {
  const patch: SlotState = { ...extracted };

  if (stepKey === "purpose" && !patch.purpose) {
    patch.purpose = value;
    return patch;
  }
  if (stepKey === "budget" && !patch.budget) {
    patch.budget = value;
    return patch;
  }
  if (stepKey === "category" && !patch.category) {
    patch.category = value;
    return patch;
  }
  if (stepKey === "delivery") {
    const skipValues = new Set(["こだわらない", "指定なし", "特になし", "なし"]);
    if (!skipValues.has(value)) {
      patch.delivery = patch.delivery && patch.delivery.length > 0 ? patch.delivery : [value];
    }
    return patch;
  }
  return patch;
}

function normalizeSession(value: unknown, steps: AssistantStepConfig[]): ConversationSession {
  if (!value || typeof value !== "object") {
    return { slots: {}, askedKeys: [] };
  }
  const session = value as { slots?: unknown; askedKeys?: unknown };
  const slots =
    session.slots && typeof session.slots === "object" ? (session.slots as SlotState) : {};
  const askedKeys = sanitizeAskedKeys(session.askedKeys, steps);
  return { slots, askedKeys };
}

function buildErrorPayload(error: unknown) {
  if (error instanceof ApiError) {
    return { status: error.status, body: { ok: false, error: error.message } };
  }

  if (error instanceof LLMProviderError) {
    const status = error.status === 429 ? 429 : error.status >= 500 ? 502 : error.status;
    return { status, body: { ok: false, error: error.message } };
  }

  const openAIError = assertOpenAIError(error);
  if (openAIError) {
    const status = openAIError.status === 429 ? 429 : 502;
    return { status, body: { ok: false, error: openAIError.message } };
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return { status: 500, body: { ok: false, error: message } };
}

function errorResponse(error: unknown) {
  const payload = buildErrorPayload(error);
  return Response.json(payload.body, { status: payload.status });
}

async function runConversation(
  body: Payload,
  onProgress?: (stage: ConversationProgressStage) => Promise<void> | void
): Promise<ConversationResponseBody> {
  const requestStartedAt = Date.now();
  const timings: DebugTiming[] = [];
  const userId = parseUserId(body.userId);
  const requestUseLlm = parseUseLlmPersonalization(body.useLlmPersonalization);
  const envEnabled = process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED === "true";
  const finalUseLlm = envEnabled && requestUseLlm;

  await onProgress?.("load_question_set");
  const published = await measureStep(
    timings,
    "load_question_set",
    async () => getPublishedQuestionSet()
  );
  const activeSteps =
    published?.steps && published.steps.length > 0
      ? published.steps
      : DEFAULT_QUESTION_SET.steps;
  const message = parseMessage(body.message);
  const current = normalizeSession(body.session, activeSteps);
  const selectedAnswer = parseSelectedAnswer(body.selectedStepKey, body.selectedValue);
  const beforeState = getQuestionState(current.slots, current.askedKeys, "", activeSteps);

  const extractionSkipped = shouldSkipSlotExtraction(selectedAnswer);
  const extracted = extractionSkipped
    ? {}
    : await (async () => {
        await onProgress?.("extract_slots");
        return measureStep(timings, "extract_slots", async () => extractSlots(message));
      })();
  const extractedWithSelected = selectedAnswer
    ? applySelectedAnswer(extracted, selectedAnswer.stepKey, selectedAnswer.value)
    : extracted;
  const slots = mergeSlots(current.slots, extractedWithSelected);
  const askedKeysBase = selectedAnswer
    ? [...current.askedKeys, selectedAnswer.stepKey]
    : current.askedKeys;
  let questionState = getQuestionState(slots, askedKeysBase, message, activeSteps);

  if (
    isOptionalStep(beforeState.nextQuestionKey, activeSteps) &&
    questionState.nextQuestionKey === beforeState.nextQuestionKey
  ) {
    questionState = getQuestionState(
      slots,
      [...askedKeysBase, beforeState.nextQuestionKey],
      message,
      activeSteps
    );
  }

  const nextQuestion = buildNextQuestion(questionState.nextQuestionKey, activeSteps);

  if (nextQuestion) {
    const nextKey = questionState.nextQuestionKey as ConversationStepKey;
    const quickRepliesBase = getQuestionQuickReplies(nextKey, activeSteps);
    const quickReplies =
      nextKey === "category"
        ? await (async () => {
            await onProgress?.("load_category_quick_replies");
            return measureStep(timings, "load_category_quick_replies", async () =>
              getRecommendCategoryQuickReplies(quickRepliesBase)
            );
          })()
        : quickRepliesBase;
    const debugInfo: DebugInfo = {
      actionPath: "ask",
      extractionSkipped,
      selectedStepKey: selectedAnswer?.stepKey ?? null,
      totalDurationMs: Date.now() - requestStartedAt,
      timings,
    };
    return {
      ok: true,
      action: "ask",
      session: { ...current, slots, askedKeys: questionState.askedKeys },
      missingKeys: questionState.remainingKeys,
      nextQuestionKey: nextKey,
      quickReplies,
      assistantMessage: nextQuestion,
      debugInfo,
    };
  }

  const topK = parseTopK(body.topK, DEFAULT_TOP_K);
  const threshold = parseThreshold(body.threshold, DEFAULT_THRESHOLD);
  const allowCategoryFallback = parseAllowCategoryFallback(body.allowCategoryFallback);
  const input: RecommendByAnswersInput = {
    budget: slots.budget,
    category: slots.category,
    purpose: slots.purpose,
    delivery: slots.delivery,
    allergen: slots.allergen,
    prefecture: slots.prefecture,
    cityCode: slots.cityCode,
    topK,
    threshold,
    allowCategoryFallback,
    userId: userId ?? undefined,
    useLlmPersonalization: finalUseLlm,
    onProgress: async (stage) => {
      await onProgress?.(mapRecommendProgressStage(stage));
    },
  };
  const result = await measureStep(timings, "recommend_by_answers", async () =>
    recommendByAnswers(input)
  );
  if (result.fallbackInfo.applied) {
    await onProgress?.("record_fallback_event");
    await measureStep(timings, "record_fallback_event", async () =>
      recordFallbackAppliedEvent({
        userId,
        topK,
        threshold,
        slots,
        allowCategoryFallback,
        fallbackInfo: result.fallbackInfo,
      })
    );
  }
  const debugInfo: DebugInfo = {
    actionPath: "recommend",
    extractionSkipped,
    selectedStepKey: selectedAnswer?.stepKey ?? null,
    totalDurationMs: Date.now() - requestStartedAt,
    timings,
    recommendation: result.debugInfo,
  };

  return {
    ok: true,
    action: "recommend",
    session: { ...current, slots, askedKeys: questionState.askedKeys },
    assistantMessage: "条件が揃いました。おすすめ結果を表示します。",
    queryText: result.queryText,
    budgetRange: result.budgetRange,
    fallbackInfo: result.fallbackInfo,
    matches: result.matches,
    debugInfo,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;
    if (!parseStreamProgress(body.streamProgress)) {
      const response = await runConversation(body);
      return Response.json(response);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const writeEvent = (payload: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        void runConversation(body, async (stage) => {
          writeEvent({
            type: "progress",
            stage,
            label: getProgressLabel(stage),
          });
        })
          .then((response) => {
            writeEvent({
              type: "result",
              data: response,
            });
            controller.close();
          })
          .catch((error) => {
            const payload = buildErrorPayload(error);
            writeEvent({
              type: "error",
              status: payload.status,
              error: payload.body.error,
            });
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
