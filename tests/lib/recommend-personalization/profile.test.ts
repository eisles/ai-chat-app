import { beforeEach, describe, expect, it, vi } from "vitest";

const getRecentClicksByUser = vi.fn();
const getProductSignals = vi.fn();
const generatePreferenceKeywordsByLlm = vi.fn();

vi.mock("@/lib/recommend-personalization/repository", () => ({
  getRecentClicksByUser,
  getProductSignals,
}));

vi.mock("@/lib/recommend-personalization/llm-keywords", () => ({
  generatePreferenceKeywordsByLlm,
}));

const { buildUserPreferenceProfile } = await import(
  "@/lib/recommend-personalization/profile"
);

describe("buildUserPreferenceProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("click履歴からカテゴリとキーワードを集計する", async () => {
    getRecentClicksByUser.mockResolvedValue([
      {
        userId: "user-1",
        productId: "p-1",
        cityCode: null,
        score: null,
        metadata: { queryText: "カテゴリ: 海鮮\n用途: 自宅用" },
        createdAt: "2026-02-20T00:00:00.000Z",
      },
      {
        userId: "user-1",
        productId: "p-2",
        cityCode: null,
        score: null,
        metadata: {},
        createdAt: "2026-02-20T00:00:00.000Z",
      },
    ]);
    getProductSignals.mockResolvedValue([
      {
        productId: "p-1",
        text: "新鮮な海鮮セット",
        metadata: {
          raw: {
            category_name: "海鮮",
            name: "海鮮詰め合わせ",
            amount: 12000,
          },
        },
      },
      {
        productId: "p-2",
        text: "黒毛和牛",
        metadata: {
          raw: {
            category_name: "肉",
            name: "黒毛和牛",
            amount: 18000,
          },
        },
      },
    ]);

    const profile = await buildUserPreferenceProfile("user-1", {
      useLlmPersonalization: false,
    });

    expect(profile).not.toBeNull();
    expect(profile?.recentProductIds).toEqual(["p-1", "p-2"]);
    expect(profile?.categoryWeights).toMatchObject({
      "海鮮": 1,
      "肉": 1,
    });
    expect(profile?.keywordWeights).toMatchObject({
      "海鮮": 2,
      "自宅用": 1,
    });
    expect(profile?.preferredAmountRange).not.toBeNull();
    expect(profile?.preferredAmountRange?.min).toBeGreaterThan(0);
    expect(profile?.preferredAmountRange?.max).toBeGreaterThan(
      profile?.preferredAmountRange?.min ?? 0
    );
    expect(generatePreferenceKeywordsByLlm).not.toHaveBeenCalled();
  });

  it("LLMキーワード補強が有効な場合は重み付けされる", async () => {
    getRecentClicksByUser.mockResolvedValue([
      {
        userId: "user-2",
        productId: "p-9",
        cityCode: null,
        score: null,
        metadata: {},
        createdAt: "2026-02-20T00:00:00.000Z",
      },
    ]);
    getProductSignals.mockResolvedValue([
      {
        productId: "p-9",
        text: "高級和牛セット",
        metadata: {
          raw: {
            category_name: "肉",
            amount: 25000,
          },
        },
      },
    ]);
    generatePreferenceKeywordsByLlm.mockResolvedValue(["高級"]);

    const profile = await buildUserPreferenceProfile("user-2", {
      useLlmPersonalization: true,
    });

    expect(profile).not.toBeNull();
    expect(generatePreferenceKeywordsByLlm).toHaveBeenCalledTimes(1);
    expect(profile?.keywordWeights).toMatchObject({
      "高級": 2,
    });
    expect(profile?.preferredAmountRange).not.toBeNull();
  });
});
