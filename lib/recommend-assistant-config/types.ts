export const ASSISTANT_STEP_KEYS = [
  "purpose",
  "budget",
  "category",
  "delivery",
  "additional",
] as const;

export type AssistantStepKey = (typeof ASSISTANT_STEP_KEYS)[number];

export type AssistantStepConfig = {
  key: AssistantStepKey;
  question: string;
  quickReplies: string[];
  optional: boolean;
  enabled: boolean;
  order: number;
};

export type AssistantQuestionSetStatus = "draft" | "published" | "archived";

export type AssistantQuestionSet = {
  id: string;
  name: string;
  version: number;
  status: AssistantQuestionSetStatus;
  steps: AssistantStepConfig[];
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export function isAssistantStepKey(value: string): value is AssistantStepKey {
  return (ASSISTANT_STEP_KEYS as readonly string[]).includes(value);
}
