import { createCompletion } from "@/lib/llm-providers";
import type { SlotState } from "./types";

const MODEL = "openai:gpt-4o-mini";
const SYSTEM_PROMPT =
  "日本語文から購買条件を抽出し、JSONのみ返す。" +
  "keys: budget, category, purpose, delivery(array), allergen, prefecture, cityCode, negativeKeywords(array)。";

type SlotPayload = {
  budget?: unknown;
  category?: unknown;
  purpose?: unknown;
  delivery?: unknown;
  allergen?: unknown;
  prefecture?: unknown;
  cityCode?: unknown;
  negativeKeywords?: unknown;
};

function parseJsonFromText(content: string): unknown {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {};
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
}

function normalizeArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  return undefined;
}

function normalizeSlots(value: unknown): SlotState {
  if (!value || typeof value !== "object") {
    return {};
  }
  const payload = value as SlotPayload;
  const slots: SlotState = {};

  if (typeof payload.budget === "string" && payload.budget.trim().length > 0) {
    slots.budget = payload.budget.trim();
  }
  if (typeof payload.category === "string" && payload.category.trim().length > 0) {
    slots.category = payload.category.trim();
  }
  if (typeof payload.purpose === "string" && payload.purpose.trim().length > 0) {
    slots.purpose = payload.purpose.trim();
  }
  if (typeof payload.allergen === "string" && payload.allergen.trim().length > 0) {
    slots.allergen = payload.allergen.trim();
  }
  if (typeof payload.prefecture === "string" && payload.prefecture.trim().length > 0) {
    slots.prefecture = payload.prefecture.trim();
  }
  if (typeof payload.cityCode === "string" && payload.cityCode.trim().length > 0) {
    slots.cityCode = payload.cityCode.trim();
  }

  const delivery = normalizeArray(payload.delivery);
  if (delivery) {
    slots.delivery = delivery;
  }

  const negativeKeywords = normalizeArray(payload.negativeKeywords);
  if (negativeKeywords) {
    slots.negativeKeywords = negativeKeywords;
  }

  return slots;
}

export async function extractSlots(message: string): Promise<SlotState> {
  const response = await createCompletion({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      { role: "user", content: message },
    ],
    temperature: 0.1,
    maxTokens: 300,
  });

  const parsed = parseJsonFromText(response.content);
  return normalizeSlots(parsed);
}
