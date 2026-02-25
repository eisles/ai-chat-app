import { DEFAULT_QUESTION_SET } from "@/lib/recommend-assistant-config/default-config";
import type { AssistantStepConfig } from "@/lib/recommend-assistant-config/types";
import type { ConversationStepKey, SlotState } from "./types";

type QuestionConfig = {
  key: ConversationStepKey;
  question: string;
  quickReplies: string[];
  optional: boolean;
  enabled: boolean;
  order: number;
};

function toQuestionConfig(step: AssistantStepConfig): QuestionConfig {
  return {
    key: step.key,
    question: step.question,
    quickReplies: step.quickReplies,
    optional: step.optional,
    enabled: step.enabled,
    order: step.order,
  };
}

function normalizeQuestionFlow(steps?: AssistantStepConfig[]): QuestionConfig[] {
  const source = Array.isArray(steps) ? steps : [];
  const filtered = source.filter((step) => step.enabled);
  const ordered = filtered
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.order - b.step.order || a.index - b.index)
    .map(({ step }) => toQuestionConfig(step));

  if (ordered.length > 0) return ordered;

  return DEFAULT_QUESTION_SET.steps.map(toQuestionConfig);
}

function normalizeString(value: string | undefined) {
  if (!value) return "";
  return value.trim();
}

function normalizeCategoryText(value: string): string {
  return value.trim().replace(/[\s・/／、,]/g, "");
}

function shouldSkipDeliveryForCategory(category: string | undefined): boolean {
  const normalized = normalizeCategoryText(normalizeString(category));
  if (!normalized) return false;

  const nonDeliveryKeywords = [
    "旅行",
    "体験",
    "温泉",
    "宿泊",
    "ホテル",
    "旅館",
    "チケット",
    "利用券",
    "クーポン",
    "アクティビティ",
    "観光",
    "レジャー",
    "入場",
  ];

  return nonDeliveryKeywords.some((keyword) => normalized.includes(keyword));
}

function hasAdditionalConstraints(slots: SlotState) {
  if (normalizeString(slots.allergen).length > 0) return true;
  if (normalizeString(slots.prefecture).length > 0) return true;
  if (normalizeString(slots.cityCode).length > 0) return true;
  if (slots.negativeKeywords && slots.negativeKeywords.length > 0) return true;
  return false;
}

function isSkipPattern(step: QuestionConfig, message: string) {
  if (!step.optional) return false;
  const normalized = message.replace(/\s+/g, "");
  if (!normalized) return false;

  if (step.key === "delivery") {
    return /(こだわらない|指定なし|特になし|なし|どちらでも|任せる)/.test(normalized);
  }
  if (step.key === "additional") {
    return /(特になし|なし|不要|こだわりなし|任せる)/.test(normalized);
  }
  return false;
}

function toAskedSet(
  askedKeys: ConversationStepKey[],
  slots: SlotState,
  flow: QuestionConfig[]
) {
  const stepKeySet = new Set(flow.map((step) => step.key));
  const asked = new Set<ConversationStepKey>(
    askedKeys.filter((key) => stepKeySet.has(key))
  );

  if (stepKeySet.has("purpose") && normalizeString(slots.purpose).length > 0) {
    asked.add("purpose");
  }
  if (stepKeySet.has("budget") && normalizeString(slots.budget).length > 0) {
    asked.add("budget");
  }
  if (stepKeySet.has("category") && normalizeString(slots.category).length > 0) {
    asked.add("category");
  }
  if (stepKeySet.has("delivery") && slots.delivery && slots.delivery.length > 0) {
    asked.add("delivery");
  }
  const deliveryStep = flow.find((step) => step.key === "delivery");
  if (
    deliveryStep?.optional &&
    stepKeySet.has("delivery") &&
    shouldSkipDeliveryForCategory(slots.category)
  ) {
    asked.add("delivery");
  }
  if (stepKeySet.has("additional") && hasAdditionalConstraints(slots)) {
    asked.add("additional");
  }

  return asked;
}

function getFirstPendingStep(
  flow: QuestionConfig[],
  askedSet: Set<ConversationStepKey>
) {
  for (const step of flow) {
    if (!askedSet.has(step.key)) {
      return step.key;
    }
  }
  return null;
}

export function mergeSlots(base: SlotState, patch: SlotState): SlotState {
  return {
    ...base,
    ...patch,
    delivery: patch.delivery ?? base.delivery ?? [],
    negativeKeywords: patch.negativeKeywords ?? base.negativeKeywords ?? [],
  };
}

export function getQuestionState(
  slots: SlotState,
  askedKeys: ConversationStepKey[],
  latestMessage: string,
  steps?: AssistantStepConfig[]
) {
  const flow = normalizeQuestionFlow(steps);
  const askedSet = toAskedSet(askedKeys, slots, flow);
  const pendingStep = getFirstPendingStep(flow, askedSet);

  if (pendingStep) {
    const step = flow.find((item) => item.key === pendingStep);
    if (step && isSkipPattern(step, latestMessage)) {
      askedSet.add(pendingStep);
    }
  }

  const nextQuestionKey = getFirstPendingStep(flow, askedSet);
  const remainingKeys = flow
    .filter((step) => !askedSet.has(step.key))
    .map((step) => step.key);

  return {
    askedKeys: Array.from(askedSet),
    nextQuestionKey,
    remainingKeys,
  };
}

export function buildNextQuestion(
  key: ConversationStepKey | null,
  steps?: AssistantStepConfig[]
) {
  if (!key) return null;
  const flow = normalizeQuestionFlow(steps);
  const config = flow.find((step) => step.key === key);
  return config?.question ?? null;
}

export function getQuestionQuickReplies(
  key: ConversationStepKey | null,
  steps?: AssistantStepConfig[]
) {
  if (!key) return [];
  const flow = normalizeQuestionFlow(steps);
  const config = flow.find((step) => step.key === key);
  return config?.quickReplies ?? [];
}

export function sanitizeAskedKeys(
  keys: unknown,
  steps?: AssistantStepConfig[]
): ConversationStepKey[] {
  if (!Array.isArray(keys)) return [];
  const flow = normalizeQuestionFlow(steps);
  const allowed = new Set(flow.map((step) => step.key));
  return keys.filter(
    (key): key is ConversationStepKey =>
      typeof key === "string" && allowed.has(key as ConversationStepKey)
  );
}

export function getQuestionFlow(steps?: AssistantStepConfig[]): QuestionConfig[] {
  return normalizeQuestionFlow(steps);
}
