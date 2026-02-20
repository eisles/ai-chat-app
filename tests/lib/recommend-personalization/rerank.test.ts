import { describe, expect, it } from "vitest";

import { applyPersonalization } from "@/lib/recommend-personalization/rerank";

const profile = {
  categoryWeights: { "海鮮": 2 },
  keywordWeights: { "特大": 2 },
  recentProductIds: ["p-2"],
};

describe("applyPersonalization", () => {
  it("個人化スコアで順位が変わる", () => {
    const matches = [
      {
        id: "m-1",
        productId: "p-1",
        cityCode: null,
        text: "北海道 海鮮 セット",
        metadata: { raw: { category_name: "海鮮" } },
        score: 0.5,
        amount: 10000,
      },
      {
        id: "m-2",
        productId: "p-2",
        cityCode: null,
        text: "特大 和牛",
        metadata: { raw: { category_name: "肉" } },
        score: 0.5,
        amount: 12000,
      },
      {
        id: "m-3",
        productId: "p-3",
        cityCode: null,
        text: "お米セット",
        metadata: { raw: { category_name: "米" } },
        score: 0.5,
        amount: 8000,
      },
    ];

    const result = applyPersonalization(matches, profile);

    expect(result[0].productId).toBe("p-1");
    expect(result[1].productId).toBe("p-2");
    expect(result[2].productId).toBe("p-3");
    expect(result[0].personalBoost).toBeGreaterThan(0);
    expect(result[0].personalReasons).toContain("最近のクリック傾向（海鮮）に一致");
    expect(result[1].personalBoost).toBeGreaterThan(0);
    expect(result[1].personalReasons).toContain("よく見ているキーワード「特大」に一致");
  });

  it("プロフィールがない場合はそのまま返す", () => {
    const matches = [
      {
        id: "m-1",
        productId: "p-1",
        cityCode: null,
        text: "北海道 海鮮 セット",
        metadata: null,
        score: 0.5,
        amount: 10000,
      },
      {
        id: "m-2",
        productId: "p-2",
        cityCode: null,
        text: "特大 和牛",
        metadata: null,
        score: 0.4,
        amount: 12000,
      },
    ];

    const result = applyPersonalization(matches, null);

    expect(result).toEqual(matches);
  });
});
