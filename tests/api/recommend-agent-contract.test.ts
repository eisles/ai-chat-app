import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentResponseSchema } from "@/lib/recommend-agent/schema";

const recommendByAnswers = vi.fn();
const createCompletion = vi.fn();
const buildUserPreferenceProfile = vi.fn();

vi.mock("@/lib/recommend/by-answers-engine", () => ({
  parseTopK: (value: unknown, fallback = 10) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(1, Math.floor(value))
      : fallback,
  parseThreshold: (value: unknown, fallback = 0.35) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback,
  recommendByAnswers,
}));

vi.mock("@/lib/image-text-search", () => ({
  assertOpenAIError: () => null,
}));

vi.mock("@/lib/llm-providers", () => ({
  createCompletion,
  LLMProviderError: class LLMProviderError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/recommend-personalization/profile", () => ({
  buildUserPreferenceProfile,
}));

const { POST } = await import("@/app/api/recommend/agent-personalized/route");

describe("agent response contract schema", () => {
  it("history_only payload is valid", () => {
    const payload = {
      ok: true,
      finalUseLlm: false,
      strategy: "history_only",
      queryText: "履歴カテゴリ: 海鮮",
      agentMessage: "クリック履歴を優先して3件を提案します。",
      agentMatches: [
        {
          id: "m-1",
          productId: "p-1",
          cityCode: "01234",
          text: "海鮮セット",
          metadata: { raw: { name: "海鮮セット" } },
          score: 0.91,
          amount: 12000,
          agentReason: "最近のクリック傾向に一致",
        },
      ],
      agentExtractionSummary: {
        searchStrategy: "history_only",
        currentConditions: ["用途: 自宅用"],
        personalizationSignals: ["最近クリックした商品数: 5件"],
        rerankRules: ["カテゴリ一致を最大 +0.12 で加点"],
        personalizedMatchCount: 1,
      },
    };

    const parsed = agentResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("current_conditions_fallback payload is valid", () => {
    const payload = {
      ok: true,
      finalUseLlm: true,
      strategy: "current_conditions_fallback",
      queryText: "カテゴリ: 魚介",
      agentMessage: "現在の条件を使って候補を提案します。",
      agentMatches: [
        {
          id: "m-2",
          productId: "p-2",
          cityCode: "01234",
          text: "魚介セット",
          metadata: { raw: { name: "魚介セット" } },
          score: 0.72,
          amount: 15000,
          agentReason: "現在の条件との一致度が高い商品です",
        },
      ],
      agentExtractionSummary: {
        searchStrategy: "current_conditions_fallback",
        currentConditions: ["カテゴリ: 魚介", "予算: 10,001〜20,000円"],
        personalizationSignals: ["LLMキーワード補強: 有効（env=true かつ UIでON）"],
        rerankRules: ["キーワード一致を最大 +0.10 で加点"],
        personalizedMatchCount: 0,
      },
    };

    const parsed = agentResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

describe("POST /api/recommend/agent-personalized contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildUserPreferenceProfile.mockResolvedValue({
      categoryWeights: { 海鮮: 3 },
      keywordWeights: { 海鮮: 2, 刺身: 1 },
      recentProductIds: ["p-click-1"],
      preferredAmountRange: { min: 11000, max: 13000, sampleCount: 1 },
    });

    recommendByAnswers.mockResolvedValue({
      queryText: "カテゴリ: 魚介",
      budgetRange: { min: 10001, max: 20000 },
      matches: [
        {
          id: "m-1",
          productId: "p-1",
          cityCode: "01234",
          text: "海鮮セット",
          metadata: { raw: { name: "海鮮セット" } },
          score: 0.81,
          amount: 12000,
          personalBoost: 0.12,
          personalReasons: ["最近のクリック傾向（海鮮）に一致"],
        },
      ],
    });
  });

  it("returns 200 and response schema-compliant payload", async () => {
    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "false";

    const req = new Request("http://localhost/api/recommend/agent-personalized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { slots: { purpose: "自宅用", budget: "10,001〜20,000円", category: "魚介" } },
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const parsed = agentResponseSchema.safeParse(json);
    expect(parsed.success).toBe(true);
  });

  it("keeps 200 response with fallback message when LLM fails", async () => {
    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "true";
    createCompletion.mockRejectedValue(new Error("llm failed"));

    const req = new Request("http://localhost/api/recommend/agent-personalized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { slots: { purpose: "自宅用", budget: "10,001〜20,000円", category: "魚介" } },
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.agentMessage).toBe("string");
    expect(json.agentMessage.length).toBeGreaterThan(0);

    const parsed = agentResponseSchema.safeParse(json);
    expect(parsed.success).toBe(true);
  });
});
