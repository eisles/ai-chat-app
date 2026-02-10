export const EXISTING_PRODUCT_BEHAVIORS = [
  "skip",
  "delete_then_insert",
] as const;

export type ExistingProductBehavior =
  (typeof EXISTING_PRODUCT_BEHAVIORS)[number];

/**
 * Parse/validate behavior for how to handle already-registered product data.
 *
 * - When omitted, defaults to "skip".
 * - When provided with an unknown value, throws.
 */
export function parseExistingProductBehavior(
  value: unknown
): ExistingProductBehavior {
  if (value === null || value === undefined || value === "") {
    return "skip";
  }
  // 互換性: 以前の "overwrite" は安全側に倒して "skip" 扱いにする
  if (value === "overwrite") {
    return "skip";
  }
  if (value === "skip" || value === "delete_then_insert") {
    return value;
  }
  throw new Error("Invalid existingBehavior");
}
