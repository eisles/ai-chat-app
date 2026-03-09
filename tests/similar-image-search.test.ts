import { describe, expect, it } from "vitest";

import {
  buildProductUrlForVectorResult,
  excludeSourceProductFromSimilarResults,
  parseSimilarImageLimit,
} from "@/lib/similar-image-search";

describe("parseSimilarImageLimit", () => {
  it("falls back to default for empty or invalid input", () => {
    expect(parseSimilarImageLimit("")).toBe(20);
    expect(parseSimilarImageLimit("abc")).toBe(20);
  });

  it("clamps to supported range", () => {
    expect(parseSimilarImageLimit("0")).toBe(1);
    expect(parseSimilarImageLimit("101")).toBe(100);
    expect(parseSimilarImageLimit("12.9")).toBe(12);
  });
});

describe("excludeSourceProductFromSimilarResults", () => {
  it("removes rows whose product_id matches the source product", () => {
    const results = [
      { id: "1", product_id: "A" },
      { id: "2", product_id: "B" },
      { id: "3", product_id: null },
    ];

    expect(
      excludeSourceProductFromSimilarResults(
        results as never,
        "A"
      ).map((row) => row.id)
    ).toEqual(["2", "3"]);
  });
});

describe("buildProductUrlForVectorResult", () => {
  it("prefers detail url when productId and cityCode are present", () => {
    expect(buildProductUrlForVectorResult("P1", "01234", "https://example.com")).toBe(
      "https://www.furusato-tax.jp/product/detail/01234/P1"
    );
  });

  it("falls back to search or raw url when ids are incomplete", () => {
    expect(buildProductUrlForVectorResult("P1", null, "https://example.com")).toBe(
      "https://www.furusato-tax.jp/search?q=P1"
    );
    expect(buildProductUrlForVectorResult(null, null, "https://example.com")).toBe(
      "https://example.com"
    );
  });
});
