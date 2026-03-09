import { beforeEach, describe, expect, it, vi } from "vitest";

const getCachedQueryEmbedding = vi.fn();
const searchTextEmbeddings = vi.fn();
const buildUserPreferenceProfile = vi.fn();
const applyPersonalization = vi.fn();

vi.mock("@/lib/recommend/query-embedding-cache", () => ({
  getCachedQueryEmbedding,
}));

vi.mock("@/lib/image-text-search", () => ({
  searchTextEmbeddings,
}));

vi.mock("@/lib/recommend-personalization/profile", () => ({
  buildUserPreferenceProfile,
}));

vi.mock("@/lib/recommend-personalization/rerank", () => ({
  applyPersonalization,
}));

const { recommendByAnswers } = await import("@/lib/recommend/by-answers-engine");

describe("recommendByAnswers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedQueryEmbedding.mockResolvedValue({
      embedding: {
        vector: [0.1, 0.2],
        model: "text-embedding-test",
        dim: 2,
        normalized: null,
        durationMs: 12,
        byteSize: 8,
      },
      cacheHit: false,
      ttlMs: 300000,
    });
    searchTextEmbeddings.mockResolvedValue([
      {
        id: "id-1",
        productId: "p-1",
        cityCode: null,
        text: "テスト",
        metadata: {
          raw: {
            amount: 12000,
            shipping_frozen_flag: 1,
            categories: [
              {
                category1_name: "魚介",
                category2_name: null,
                category3_name: null,
              },
            ],
          },
        },
        score: 0.91,
        amount: 12000,
      },
    ]);
    applyPersonalization.mockImplementation((matches) => matches);
  });

  it("useLlmPersonalization=false のときは個人化プロフィールを構築しない", async () => {
    const progressStages: string[] = [];

    const result = await recommendByAnswers({
      budget: "10,001〜20,000円",
      category: "魚介",
      purpose: "自宅用",
      delivery: ["冷凍"],
      userId: "user-1",
      useLlmPersonalization: false,
      onProgress: (stage) => {
        progressStages.push(stage);
      },
    });

    expect(buildUserPreferenceProfile).not.toHaveBeenCalled();
    expect(applyPersonalization).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(1);
    expect(result.debugInfo.personalization).toEqual({
      attempted: false,
      profileBuilt: false,
      applied: false,
      useLlmPersonalization: false,
    });
    expect(result.debugInfo.embeddingCache).toEqual({
      hit: false,
      ttlMs: 300000,
    });
    expect(progressStages).not.toContain("build_user_preference_profile");
    expect(progressStages).not.toContain("apply_personalization");
    expect(
      result.debugInfo.timings.some(
        (timing) => timing.name === "build_user_preference_profile"
      )
    ).toBe(false);
  });

  it("useLlmPersonalization=true かつ userId ありのときだけ個人化を適用する", async () => {
    const progressStages: string[] = [];
    getCachedQueryEmbedding.mockResolvedValue({
      embedding: {
        vector: [0.1, 0.2],
        model: "text-embedding-test",
        dim: 2,
        normalized: null,
        durationMs: 3,
        byteSize: 8,
      },
      cacheHit: true,
      ttlMs: 300000,
    });
    buildUserPreferenceProfile.mockResolvedValue({ clickedProductIds: ["p-1"] });
    applyPersonalization.mockImplementation((matches) =>
      matches.map((match) => ({
        ...match,
        personalBoost: 0.25,
        personalReasons: ["clicked"],
      }))
    );

    const result = await recommendByAnswers({
      budget: "10,001〜20,000円",
      category: "魚介",
      purpose: "自宅用",
      delivery: ["冷凍"],
      userId: "user-1",
      useLlmPersonalization: true,
      onProgress: (stage) => {
        progressStages.push(stage);
      },
    });

    expect(buildUserPreferenceProfile).toHaveBeenCalledWith("user-1", {
      useLlmPersonalization: true,
    });
    expect(applyPersonalization).toHaveBeenCalledTimes(1);
    expect(result.matches[0]).toMatchObject({
      productId: "p-1",
      personalBoost: 0.25,
      personalReasons: ["clicked"],
    });
    expect(result.debugInfo.personalization).toEqual({
      attempted: true,
      profileBuilt: true,
      applied: true,
      useLlmPersonalization: true,
    });
    expect(result.debugInfo.embeddingCache).toEqual({
      hit: true,
      ttlMs: 300000,
    });
    expect(progressStages).toContain("build_user_preference_profile");
    expect(progressStages).toContain("apply_personalization");
  });

  it("予算条件を SQL 検索に pushdown し、配送希望の「特になし」では配送フィルタを掛けない", async () => {
    searchTextEmbeddings.mockResolvedValue([
      {
        id: "fruit-1",
        productId: "p-fruit-1",
        cityCode: null,
        text: "果物テスト",
        metadata: {
          raw: {
            amount: 18000,
            shipping_frozen_flag: 0,
            categories: [
              {
                category1_name: "果物",
                category2_name: null,
                category3_name: null,
              },
            ],
          },
        },
        score: 0.88,
        amount: 18000,
      },
    ]);

    const result = await recommendByAnswers({
      budget: "10,001〜20,000円",
      category: "果物",
      purpose: "自宅用",
      delivery: ["特になし"],
      topK: 10,
      threshold: 0.35,
    });

    expect(searchTextEmbeddings).toHaveBeenCalledWith({
      embedding: [0.1, 0.2],
      topK: 50,
      threshold: 0.35,
      amountMin: 10001,
      amountMax: 20000,
      deliveryFilters: [],
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      productId: "p-fruit-1",
      amount: 18000,
    });
    expect(result.debugInfo.counts).toEqual({
      rawMatches: 1,
      budgetFiltered: 1,
      categoryFiltered: 1,
      deliveryFiltered: 1,
    });
  });

  it("配送条件があるときは内部候補数を広げてから配送フィルタし、最終件数は topK に揃える", async () => {
    searchTextEmbeddings.mockResolvedValue([
      {
        id: "fruit-1",
        productId: "p-fruit-1",
        cityCode: null,
        text: "果物テスト1",
        metadata: {
          raw: {
            amount: 9000,
            shipping_refrigerated_flag: 1,
            categories: [{ category1_name: "果物", category2_name: null, category3_name: null }],
          },
        },
        score: 0.88,
        amount: 9000,
      },
      {
        id: "fruit-2",
        productId: "p-fruit-2",
        cityCode: null,
        text: "果物テスト2",
        metadata: {
          raw: {
            amount: 8000,
            shipping_refrigerated_flag: 1,
            categories: [{ category1_name: "果物", category2_name: null, category3_name: null }],
          },
        },
        score: 0.87,
        amount: 8000,
      },
    ]);

    const result = await recommendByAnswers({
      budget: "5,001〜10,000円",
      category: "果物",
      purpose: "自宅用",
      delivery: ["冷蔵"],
      topK: 1,
      threshold: 0.35,
    });

    expect(searchTextEmbeddings).toHaveBeenCalledWith({
      embedding: [0.1, 0.2],
      topK: 50,
      threshold: 0.35,
      amountMin: 5001,
      amountMax: 10000,
      deliveryFilters: ["冷蔵"],
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.productId).toBe("p-fruit-1");
    expect(result.debugInfo.counts.deliveryFiltered).toBe(2);
  });
});
