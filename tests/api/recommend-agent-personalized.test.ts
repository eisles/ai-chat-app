import { beforeEach, describe, expect, it, vi } from "vitest";

const recommendByAnswers = vi.fn();
const createCompletion = vi.fn();
const buildUserPreferenceProfile = vi.fn();

vi.mock("@/lib/recommend/by-answers-engine", () => ({
  parseTopK: (value: unknown, fallback = 10) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback,
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

describe("POST /api/recommend/agent-personalized", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildUserPreferenceProfile.mockResolvedValue({
      categoryWeights: { 海鮮: 3, 肉: 1 },
      keywordWeights: { 海鮮: 4, 刺身: 2, 自宅用: 1 },
      recentProductIds: ["p-click-1", "p-click-2"],
      preferredAmountRange: { min: 11000, max: 13000, sampleCount: 2 },
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
        {
          id: "m-2",
          productId: "p-2",
          cityCode: "01234",
          text: "肉セット",
          metadata: { raw: { name: "肉セット" } },
          score: 0.74,
          amount: 11000,
        },
      ],
    });
  });

  it("正常系: agentMatches を返す", async () => {
    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "false";

    const req = new Request("http://localhost/api/recommend/agent-personalized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          slots: {
            purpose: "自宅用",
            budget: "10,001〜20,000円",
            category: "魚介",
          },
        },
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.finalUseLlm).toBe(false);
    expect(json.strategy).toBe("history_only");
    expect(json.agentMatches).toHaveLength(2);
    expect(json.agentMatches[0].agentReason).toContain("最近のクリック傾向");
    expect(json.agentExtractionSummary).toBeTruthy();
    expect(json.agentExtractionSummary.searchStrategy).toBe("history_only");
    expect(json.agentExtractionSummary.personalizationSignals[0]).toContain(
      "最近クリックした商品数"
    );
    expect(json.agentExtractionSummary.personalizationSignals).toContain(
      "履歴金額レンジ: 11,000〜13,000円（適用）"
    );
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("異常系: userId が不正なら 400", async () => {
    const req = new Request("http://localhost/api/recommend/agent-personalized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "invalid",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("LLM失敗時はフォールバックして 200 を返す", async () => {
    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "true";
    createCompletion.mockRejectedValue(new Error("llm failed"));

    const req = new Request("http://localhost/api/recommend/agent-personalized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          slots: {
            purpose: "自宅用",
            budget: "10,001〜20,000円",
            category: "魚介",
          },
        },
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.finalUseLlm).toBe(true);
    expect(typeof json.agentMessage).toBe("string");
    expect(json.agentMessage.length).toBeGreaterThan(0);
    expect(json.strategy).toBe("history_only");
    expect(json.agentExtractionSummary.personalizationSignals).toContain(
      "LLMキーワード補強: 有効（env=true かつ UIでON）"
    );
  });

  it("履歴優先でヒットしない場合は現在条件検索へフォールバックする", async () => {
    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "false";

    recommendByAnswers
      .mockResolvedValueOnce({
        queryText: "履歴カテゴリ: 海鮮",
        budgetRange: null,
        matches: [],
      })
      .mockResolvedValueOnce({
        queryText: "カテゴリ: 魚介",
        budgetRange: { min: 10001, max: 20000 },
        matches: [
          {
            id: "m-fallback-1",
            productId: "p-fallback-1",
            cityCode: "01234",
            text: "フォールバック候補",
            metadata: { raw: { name: "フォールバック候補" } },
            score: 0.7,
            amount: 15000,
          },
        ],
      });

    const req = new Request("http://localhost/api/recommend/agent-personalized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          slots: {
            purpose: "自宅用",
            budget: "10,001〜20,000円",
            category: "魚介",
          },
        },
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: false,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.strategy).toBe("current_conditions_fallback");
    expect(json.agentExtractionSummary.searchStrategy).toBe(
      "current_conditions_fallback"
    );
    expect(recommendByAnswers).toHaveBeenCalledTimes(2);
    expect(recommendByAnswers.mock.calls[0][0]).toMatchObject({
      queryText: expect.stringContaining("履歴カテゴリ"),
    });
    expect(recommendByAnswers.mock.calls[1][0]).toMatchObject({
      category: "魚介",
      purpose: "自宅用",
      budget: "10,001〜20,000円",
    });
  });
});
