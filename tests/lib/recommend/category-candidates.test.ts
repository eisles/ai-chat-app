import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.fn();

vi.mock("@/lib/neon", () => ({
  getDb: () => db,
}));

describe("recommend category candidates", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    db.mockReset();
    const { clearRecommendCategoryCandidatesMemoryCache } = await import(
      "@/lib/recommend/category-candidates"
    );
    clearRecommendCategoryCandidatesMemoryCache();
  });

  it("reads quick replies from the cache table", async () => {
    db.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("recommend_category_candidates_cache")) {
        return Promise.resolve([
          { name: "魚介", count: 120 },
          { name: "旅行・体験", count: 80 },
        ]);
      }
      return Promise.resolve([]);
    });

    const { getRecommendCategoryQuickReplies } = await import(
      "@/lib/recommend/category-candidates"
    );
    const replies = await getRecommendCategoryQuickReplies(["肉", "魚介"], 5);

    expect(replies).toEqual(["肉", "魚介", "旅行・体験"]);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("falls back immediately when the cache table is empty", async () => {
    db.mockResolvedValue([]);

    const { getRecommendCategoryQuickReplies } = await import(
      "@/lib/recommend/category-candidates"
    );
    const replies = await getRecommendCategoryQuickReplies(["肉", "魚介"], 5);

    expect(replies).toEqual(["肉", "魚介"]);
  });
});
