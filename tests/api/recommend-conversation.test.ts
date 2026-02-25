import { beforeEach, describe, expect, it, vi } from "vitest";

const createCompletion = vi.fn();
const generateTextEmbedding = vi.fn();
const searchTextEmbeddings = vi.fn();
const getRecommendCategoryQuickReplies = vi.fn();
const getPublishedQuestionSet = vi.fn();
const recommendByAnswers = vi.fn();

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

vi.mock("@/lib/image-text-search", () => ({
  generateTextEmbedding,
  searchTextEmbeddings,
  assertOpenAIError: () => null,
}));

vi.mock("@/lib/recommend/by-answers-engine", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/recommend/by-answers-engine")
  >("@/lib/recommend/by-answers-engine");
  recommendByAnswers.mockImplementation(actual.recommendByAnswers);
  return {
    ...actual,
    recommendByAnswers,
  };
});

vi.mock("@/lib/recommend/category-candidates", () => ({
  getRecommendCategoryQuickReplies,
}));

vi.mock("@/lib/recommend-assistant-config/repository", () => ({
  getPublishedQuestionSet,
}));

const { POST } = await import("@/app/api/recommend/conversation/route");

describe("POST /api/recommend/conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecommendCategoryQuickReplies.mockResolvedValue([
      "肉",
      "魚介",
      "果物",
      "旅行・体験",
      "温泉",
    ]);
    getPublishedQuestionSet.mockResolvedValue(null);
  });

  it("必須スロット不足時は ask を返す", async () => {
    createCompletion.mockResolvedValue({
      content: "{\"budget\":\"10,001〜20,000円\"}",
    });

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "1万円ぐらい" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.action).toBe("ask");
    expect(json.nextQuestionKey).toBe("purpose");
    expect(json.missingKeys).toContain("purpose");
    expect(json.quickReplies).toContain("自宅用");
  });

  it("5ステップが充足した場合は recommend を返す", async () => {
    createCompletion.mockResolvedValue({
      content:
        "{\"budget\":\"10,001〜20,000円\",\"category\":\"魚介\",\"purpose\":\"自宅用\",\"delivery\":[\"冷凍\"],\"allergen\":\"なし\"}",
    });
    generateTextEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      model: "text-embedding-test",
      dim: 2,
      normalized: null,
      durationMs: 12,
      byteSize: 8,
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

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "1万円前後で魚介が欲しい" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.action).toBe("recommend");
    expect(json.matches).toHaveLength(1);
    expect(json.queryText).toContain("カテゴリ: 魚介");
    expect(searchTextEmbeddings).toHaveBeenCalledWith({
      embedding: [0.1, 0.2],
      topK: 10,
      threshold: 0.35,
    });
  });

  it("旅行・体験カテゴリは raw のカテゴリ系フィールドでも一致する", async () => {
    createCompletion.mockResolvedValue({
      content:
        "{\"budget\":\"30,001円以上\",\"category\":\"旅行・体験\",\"purpose\":\"自宅用\",\"delivery\":[\"冷凍\"],\"allergen\":\"なし\"}",
    });
    generateTextEmbedding.mockResolvedValue({
      vector: [0.2, 0.3],
      model: "text-embedding-test",
      dim: 2,
      normalized: null,
      durationMs: 12,
      byteSize: 8,
    });
    searchTextEmbeddings.mockResolvedValue([
      {
        id: "id-travel-1",
        productId: "p-travel-1",
        cityCode: null,
        text: "テスト旅行",
        metadata: {
          raw: {
            amount: 50000,
            shipping_frozen_flag: 1,
            category_name: "旅行",
            genre: "体験",
          },
        },
        score: 0.82,
        amount: 50000,
      },
    ]);

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "旅行体験が欲しい" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.action).toBe("recommend");
    expect(json.matches).toHaveLength(1);
    expect(json.queryText).toContain("カテゴリ: 旅行・体験");
  });

  it("配送をスキップ入力した場合は追加条件の質問に進む", async () => {
    createCompletion
      .mockResolvedValueOnce({
        content: "{\"budget\":\"10,001〜20,000円\",\"category\":\"魚介\",\"purpose\":\"自宅用\"}",
      })
      .mockResolvedValueOnce({
        content: "{}",
      });

    const firstReq = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "自宅用で1万円前後の魚介" }),
    });
    const firstRes = await POST(firstReq);
    const firstJson = await firstRes.json();

    expect(firstJson.action).toBe("ask");
    expect(firstJson.nextQuestionKey).toBe("delivery");

    const secondReq = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "こだわらない",
        session: firstJson.session,
      }),
    });
    const secondRes = await POST(secondReq);
    const secondJson = await secondRes.json();

    expect(secondRes.status).toBe(200);
    expect(secondJson.action).toBe("ask");
    expect(secondJson.nextQuestionKey).toBe("additional");
    expect(secondJson.quickReplies).toContain("特になし");
  });

  it("配送回答の抽出に失敗してもループせず次質問へ進む", async () => {
    createCompletion
      .mockResolvedValueOnce({
        content: "{\"budget\":\"10,001〜20,000円\",\"category\":\"魚介\",\"purpose\":\"自宅用\"}",
      })
      .mockResolvedValueOnce({
        content: "{}",
      });

    const firstReq = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "自宅用で1万円前後の魚介" }),
    });
    const firstRes = await POST(firstReq);
    const firstJson = await firstRes.json();

    expect(firstJson.action).toBe("ask");
    expect(firstJson.nextQuestionKey).toBe("delivery");

    const secondReq = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "お願いします",
        session: firstJson.session,
      }),
    });
    const secondRes = await POST(secondReq);
    const secondJson = await secondRes.json();

    expect(secondRes.status).toBe(200);
    expect(secondJson.action).toBe("ask");
    expect(secondJson.nextQuestionKey).toBe("additional");
  });

  it("カテゴリ質問時は既存データ由来のカテゴリ候補を返す", async () => {
    createCompletion.mockResolvedValue({
      content: "{\"purpose\":\"自宅用\",\"budget\":\"10,001〜20,000円\"}",
    });

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "自宅用で1万円くらい" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe("ask");
    expect(json.nextQuestionKey).toBe("category");
    expect(getRecommendCategoryQuickReplies).toHaveBeenCalledTimes(1);
    expect(json.quickReplies).toContain("旅行・体験");
    expect(json.quickReplies).toContain("温泉");
  });

  it("カテゴリ選択肢を選んだ場合は抽出失敗でも次の質問へ進む", async () => {
    createCompletion.mockResolvedValue({
      content: "{}",
    });

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "米・パン",
        selectedStepKey: "category",
        selectedValue: "米・パン",
        session: {
          slots: {
            purpose: "自宅用",
            budget: "10,001〜20,000円",
          },
          askedKeys: ["purpose", "budget"],
        },
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe("ask");
    expect(json.nextQuestionKey).toBe("delivery");
    expect(json.quickReplies[0]).toBe("特になし");
    expect(json.session.slots.category).toBe("米・パン");
  });

  it("旅行・体験系カテゴリなら配送質問をスキップして追加条件へ進む", async () => {
    createCompletion.mockResolvedValue({
      content: "{}",
    });

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "旅行・体験",
        selectedStepKey: "category",
        selectedValue: "旅行・体験",
        session: {
          slots: {
            purpose: "自宅用",
            budget: "10,001〜20,000円",
          },
          askedKeys: ["purpose", "budget"],
        },
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe("ask");
    expect(json.nextQuestionKey).toBe("additional");
    expect(json.quickReplies).toContain("特になし");
    expect(json.session.slots.category).toBe("旅行・体験");
  });

  it("公開済み設定がある場合は質問文と選択肢に反映される", async () => {
    getPublishedQuestionSet.mockResolvedValue({
      id: "set-1",
      name: "公開セット",
      version: 1,
      status: "published",
      steps: [
        {
          key: "purpose",
          question: "新しい用途を教えてください",
          quickReplies: ["自分用"],
          optional: false,
          enabled: true,
          order: 1,
        },
        {
          key: "budget",
          question: "新しい予算質問",
          quickReplies: ["〜5,000円"],
          optional: false,
          enabled: true,
          order: 2,
        },
        {
          key: "category",
          question: "新しいカテゴリ質問",
          quickReplies: ["米"],
          optional: false,
          enabled: true,
          order: 3,
        },
        {
          key: "delivery",
          question: "配送はどうしますか？",
          quickReplies: ["冷凍"],
          optional: true,
          enabled: true,
          order: 4,
        },
        {
          key: "additional",
          question: "追加条件はありますか？",
          quickReplies: ["特になし"],
          optional: true,
          enabled: true,
          order: 5,
        },
      ],
      meta: {},
      createdAt: "2026-02-17T00:00:00.000Z",
      updatedAt: "2026-02-17T00:00:00.000Z",
      publishedAt: "2026-02-17T00:00:00.000Z",
    });

    createCompletion.mockResolvedValue({
      content: "{\"budget\":\"10,001〜20,000円\"}",
    });

    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "1万円くらい" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.action).toBe("ask");
    expect(json.nextQuestionKey).toBe("purpose");
    expect(json.assistantMessage).toBe("新しい用途を教えてください");
    expect(json.quickReplies).toContain("自分用");
  });

  it("userIdが不正な場合は400を返す", async () => {
    const req = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "1万円くらい", userId: "invalid" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("LLM個人化はenvとrequestの両方がtrueのときのみ有効になる", async () => {
    const originalEnv = process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED;

    recommendByAnswers.mockResolvedValueOnce({
      queryText: "テスト",
      budgetRange: null,
      matches: [],
    });
    recommendByAnswers.mockResolvedValueOnce({
      queryText: "テスト",
      budgetRange: null,
      matches: [],
    });

    createCompletion.mockResolvedValue({
      content:
        "{\"budget\":\"10,001〜20,000円\",\"category\":\"魚介\",\"purpose\":\"自宅用\",\"delivery\":[\"冷凍\"],\"allergen\":\"なし\"}",
    });
    generateTextEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      model: "text-embedding-test",
      dim: 2,
      normalized: null,
      durationMs: 12,
      byteSize: 8,
    });
    searchTextEmbeddings.mockResolvedValue([
      {
        id: "id-1",
        productId: "p-1",
        cityCode: null,
        text: "テスト",
        metadata: null,
        score: 0.91,
        amount: 12000,
      },
    ]);

    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "false";
    const reqDisabled = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "1万円前後で魚介が欲しい",
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: true,
      }),
    });
    await POST(reqDisabled);
    const disabledInput = recommendByAnswers.mock.calls.at(-1)?.[0];
    expect(disabledInput?.useLlmPersonalization).toBe(false);

    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = "true";
    const reqEnabled = new Request("http://localhost/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "1万円前後で魚介が欲しい",
        userId: "6f4e2d7a-4b6d-4a52-9d62-0d0c2b7c8e1a",
        useLlmPersonalization: true,
      }),
    });
    await POST(reqEnabled);
    const enabledInput = recommendByAnswers.mock.calls.at(-1)?.[0];
    expect(enabledInput?.useLlmPersonalization).toBe(true);

    process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED = originalEnv;
  });
});
