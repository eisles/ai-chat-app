import { describe, expect, it } from "vitest";

import { parseExistingProductBehavior } from "@/lib/product-import-behavior";

describe("parseExistingProductBehavior", () => {
  it("defaults to skip when omitted", () => {
    expect(parseExistingProductBehavior(undefined)).toBe("skip");
    expect(parseExistingProductBehavior(null)).toBe("skip");
    expect(parseExistingProductBehavior("")).toBe("skip");
  });

  it("accepts supported values", () => {
    expect(parseExistingProductBehavior("skip")).toBe("skip");
    expect(parseExistingProductBehavior("delete_then_insert")).toBe("delete_then_insert");
  });

  it("treats legacy overwrite as skip (safe)", () => {
    expect(parseExistingProductBehavior("overwrite")).toBe("skip");
  });

  it("throws on invalid values", () => {
    expect(() => parseExistingProductBehavior("unknown")).toThrow();
  });
});

