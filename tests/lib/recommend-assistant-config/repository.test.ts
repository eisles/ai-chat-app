import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.fn();

vi.mock("@/lib/neon", () => ({
  getDb: () => db,
}));

const PUBLISHED_ROW = {
  id: "set-1",
  name: "公開セット",
  version: 1,
  status: "published" as const,
  steps: [
    {
      key: "purpose",
      question: "何に使いますか？",
      quickReplies: ["自宅用"],
      optional: false,
      enabled: true,
      order: 0,
    },
  ],
  meta: {},
  created_at: new Date("2026-03-09T12:00:00.000Z"),
  updated_at: new Date("2026-03-09T12:00:00.000Z"),
  published_at: new Date("2026-03-09T12:00:00.000Z"),
};

describe("recommend assistant question set repository", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    db.mockReset();
    const { clearPublishedQuestionSetCache } = await import(
      "@/lib/recommend-assistant-config/repository"
    );
    clearPublishedQuestionSetCache();
  });

  it("公開質問セット取得を TTL 内でキャッシュする", async () => {
    let publishedSelectCalls = 0;
    db.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("from recommend_assistant_question_sets")) {
        publishedSelectCalls += 1;
        return Promise.resolve([PUBLISHED_ROW]);
      }
      return Promise.resolve([]);
    });

    const { getPublishedQuestionSet } = await import(
      "@/lib/recommend-assistant-config/repository"
    );

    const first = await getPublishedQuestionSet();
    const second = await getPublishedQuestionSet();

    expect(first?.id).toBe("set-1");
    expect(second?.id).toBe("set-1");
    expect(publishedSelectCalls).toBe(1);
  });

  it("公開セットが未作成でも null をキャッシュする", async () => {
    let publishedSelectCalls = 0;
    db.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("from recommend_assistant_question_sets")) {
        publishedSelectCalls += 1;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { getPublishedQuestionSet } = await import(
      "@/lib/recommend-assistant-config/repository"
    );

    const first = await getPublishedQuestionSet();
    const second = await getPublishedQuestionSet();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(publishedSelectCalls).toBe(1);
  });

  it("publish 後は公開質問セットキャッシュを無効化する", async () => {
    let publishedSelectCalls = 0;
    let currentPublishedRow = PUBLISHED_ROW;

    db.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("from recommend_assistant_question_sets")) {
        publishedSelectCalls += 1;
        return Promise.resolve([currentPublishedRow]);
      }
      if (sql.includes("set status = 'published'")) {
        currentPublishedRow = {
          ...PUBLISHED_ROW,
          id: "set-2",
          name: "公開セット v2",
          version: 2,
          updated_at: new Date("2026-03-09T12:05:00.000Z"),
          published_at: new Date("2026-03-09T12:05:00.000Z"),
        };
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { getPublishedQuestionSet, publishSet } = await import(
      "@/lib/recommend-assistant-config/repository"
    );

    const beforePublish = await getPublishedQuestionSet();
    await publishSet("set-2");
    const afterPublish = await getPublishedQuestionSet();

    expect(beforePublish?.id).toBe("set-1");
    expect(afterPublish?.id).toBe("set-2");
    expect(publishedSelectCalls).toBe(2);
  });
});
