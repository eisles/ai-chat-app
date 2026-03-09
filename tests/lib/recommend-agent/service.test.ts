import { beforeEach, describe, expect, it, vi } from "vitest";

const recommendByAnswers = vi.fn();
const buildUserPreferenceProfile = vi.fn();
const createCompletion = vi.fn();

vi.mock("@/lib/recommend/by-answers-engine", () => ({
  recommendByAnswers,
}));

vi.mock("@/lib/recommend-personalization/profile", () => ({
  buildUserPreferenceProfile,
}));

vi.mock("@/lib/llm-providers", () => ({
  createCompletion,
}));

const { runRecommendAgent } = await import("@/lib/recommend-agent/service");

describe("runRecommendAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("履歴検索で候補があれば history_only を返す", async () => {
    buildUserPreferenceProfile.mockResolvedValue({
      categoryWeights: { 海鮮: 3 },
      keywordWeights: { 刺身: 2 },
      recentProductIds: ["p-click-1"],
      preferredAmountRange: { min: 10000, max: 13000, sampleCount: 1 },
    });
    recommendByAnswers.mockResolvedValue({
      queryText: "履歴カテゴリ: 海鮮",
      budgetRange: null,
      matches: [
        {
          id: "m-1",
          productId: "p-1",
          cityCode: "01234",
          text: "海鮮セット",
          metadata: { raw: { name: "海鮮セット" } },
          score: 0.82,
          amount: 12000,
          personalBoost: 0.12,
          personalReasons: ["最近のクリック傾向（海鮮）に一致"],
        },
      ],
    });

    const result = await runRecommendAgent({
      userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
      slots: { category: "魚介", budget: "10,001〜20,000円", purpose: "自宅用" },
      topK: 10,
      threshold: 0.35,
      finalUseLlm: false,
    });

    expect(result.strategy).toBe("history_only");
    expect(result.queryText).toContain("履歴カテゴリ");
    expect(result.agentMatches).toHaveLength(1);
    expect(result.agentMatches[0].agentReason).toContain("最近のクリック傾向");
    expect(result.agentExtractionSummary.searchStrategy).toBe("history_only");
    expect(result.agentExtractionSummary.personalizationSignals).toContain(
      "履歴金額レンジ: 10,000〜13,000円（適用）"
    );
    expect(recommendByAnswers).toHaveBeenCalledTimes(1);
    expect(recommendByAnswers).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: expect.stringContaining("履歴カテゴリ"),
      })
    );
  });

  it("履歴検索が空なら current_conditions_fallback を返す", async () => {
    buildUserPreferenceProfile.mockResolvedValue({
      categoryWeights: { 海鮮: 3 },
      keywordWeights: { 刺身: 2 },
      recentProductIds: ["p-click-1"],
      preferredAmountRange: { min: 10000, max: 13000, sampleCount: 1 },
    });
    recommendByAnswers
      .mockResolvedValueOnce({
        queryText: "履歴カテゴリ: 海鮮",
        budgetRange: null,
        matches: [
          {
            id: "m-out",
            productId: "p-out",
            cityCode: "01234",
            text: "高額候補",
            metadata: { raw: { name: "高額候補" } },
            score: 0.9,
            amount: 50000,
          },
        ],
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
            score: 0.71,
            amount: 15000,
          },
        ],
      });

    const result = await runRecommendAgent({
      userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
      slots: { category: "魚介", budget: "10,001〜20,000円", purpose: "自宅用" },
      topK: 10,
      threshold: 0.35,
      finalUseLlm: false,
    });

    expect(result.strategy).toBe("current_conditions_fallback");
    expect(result.queryText).toBe("カテゴリ: 魚介");
    expect(recommendByAnswers).toHaveBeenCalledTimes(2);
    expect(recommendByAnswers.mock.calls[1][0]).toMatchObject({
      category: "魚介",
      budget: "10,001〜20,000円",
      purpose: "自宅用",
    });
  });

  it("履歴がない場合は current_conditions_only を返す", async () => {
    buildUserPreferenceProfile.mockResolvedValue(null);
    recommendByAnswers.mockResolvedValue({
      queryText: "カテゴリ: 魚介",
      budgetRange: { min: 10001, max: 20000 },
      matches: [],
    });

    const result = await runRecommendAgent({
      userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
      slots: { category: "魚介" },
      topK: 10,
      threshold: 0.35,
      finalUseLlm: false,
    });

    expect(result.strategy).toBe("current_conditions_only");
    expect(result.queryText).toBe("カテゴリ: 魚介");
    expect(result.agentExtractionSummary.personalizationSignals).toEqual([
      "クリック履歴がないため、現在条件のみで候補を抽出",
    ]);
    expect(recommendByAnswers).toHaveBeenCalledTimes(1);
  });

  it("LLM失敗時はフォールバックメッセージを返す", async () => {
    buildUserPreferenceProfile.mockResolvedValue(null);
    recommendByAnswers.mockResolvedValue({
      queryText: "カテゴリ: 魚介",
      budgetRange: null,
      matches: [
        {
          id: "m-1",
          productId: "p-1",
          cityCode: "01234",
          text: "海鮮セット",
          metadata: { raw: { name: "海鮮セット" } },
          score: 0.82,
          amount: 12000,
        },
      ],
    });
    createCompletion.mockRejectedValue(new Error("llm failed"));

    const result = await runRecommendAgent({
      userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
      slots: { category: "魚介" },
      topK: 10,
      threshold: 0.35,
      finalUseLlm: true,
    });

    expect(createCompletion).toHaveBeenCalledTimes(1);
    expect(result.agentMessage).toBe("現在の条件を優先して1件を提案します。");
  });
});
