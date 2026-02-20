import { assertOpenAIError } from "@/lib/image-text-search";
import { LLMProviderError } from "@/lib/llm-providers";
import {
  parseThreshold,
  parseTopK,
  recommendByAnswers,
  type RecommendByAnswersInput,
} from "@/lib/recommend/by-answers-engine";
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
  selectedStepKey?: unknown;
  selectedValue?: unknown;
  userId?: unknown;
  useLlmPersonalization?: unknown;
};

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
    const requestUseLlm = parseUseLlmPersonalization(body.useLlmPersonalization);
    const envEnabled = process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED === "true";
    const finalUseLlm = envEnabled && requestUseLlm;
    const published = await getPublishedQuestionSet();
    const activeSteps =
      published?.steps && published.steps.length > 0
        ? published.steps
        : DEFAULT_QUESTION_SET.steps;
    const message = parseMessage(body.message);
    const current = normalizeSession(body.session, activeSteps);
    const selectedAnswer = parseSelectedAnswer(body.selectedStepKey, body.selectedValue);
    const beforeState = getQuestionState(
      current.slots,
      current.askedKeys,
      "",
      activeSteps
    );

    const extracted = await extractSlots(message);
    const extractedWithSelected = selectedAnswer
      ? applySelectedAnswer(extracted, selectedAnswer.stepKey, selectedAnswer.value)
      : extracted;
    const slots = mergeSlots(current.slots, extractedWithSelected);
    const askedKeysBase = selectedAnswer
      ? [...current.askedKeys, selectedAnswer.stepKey]
      : current.askedKeys;
    let questionState = getQuestionState(slots, askedKeysBase, message, activeSteps);

    // delivery/additional は任意項目なので、回答メッセージが来たら抽出失敗時でも先に進める
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
          ? await getRecommendCategoryQuickReplies(quickRepliesBase)
          : quickRepliesBase;
      return Response.json({
        ok: true,
        action: "ask",
        session: { ...current, slots, askedKeys: questionState.askedKeys },
        missingKeys: questionState.remainingKeys,
        nextQuestionKey: nextKey,
        quickReplies,
        assistantMessage: nextQuestion,
      });
    }

    const topK = parseTopK(body.topK, DEFAULT_TOP_K);
    const threshold = parseThreshold(body.threshold, DEFAULT_THRESHOLD);
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
      userId: userId ?? undefined,
      useLlmPersonalization: finalUseLlm,
    };
    const result = await recommendByAnswers(input);

    return Response.json({
      ok: true,
      action: "recommend",
      session: { ...current, slots, askedKeys: questionState.askedKeys },
      assistantMessage: "条件が揃いました。おすすめ結果を表示します。",
      queryText: result.queryText,
      budgetRange: result.budgetRange,
      matches: result.matches,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
