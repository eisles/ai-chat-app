export type SimilarImageResult = {
  id: string;
  city_code: string | null;
  product_id: string | null;
  slide_index: number | null;
  image_url: string;
  distance: number;
  metadata: Record<string, unknown> | null;
  amount: number | null;
};

export const DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT = 20;
export const MIN_SIMILAR_IMAGE_RESULT_LIMIT = 1;
export const MAX_SIMILAR_IMAGE_RESULT_LIMIT = 100;

export function buildProductUrlForVectorResult(
  productId: string | null,
  cityCode: string | null,
  fallbackUrl: string
): string {
  if (productId && cityCode) {
    return `https://www.furusato-tax.jp/product/detail/${cityCode}/${productId}`;
  }
  if (productId) {
    return `https://www.furusato-tax.jp/search?q=${productId}`;
  }
  return fallbackUrl;
}

export function parseSimilarImageLimit(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT;
  const intValue = Math.floor(parsed);
  return Math.max(
    MIN_SIMILAR_IMAGE_RESULT_LIMIT,
    Math.min(intValue, MAX_SIMILAR_IMAGE_RESULT_LIMIT)
  );
}

export function excludeSourceProductFromSimilarResults(
  results: SimilarImageResult[] | undefined,
  sourceProductId: string
): SimilarImageResult[] {
  if (!results || results.length === 0) return [];
  const trimmedSourceProductId = sourceProductId.trim();
  if (!trimmedSourceProductId) return results;
  return results.filter((row) => row.product_id !== trimmedSourceProductId);
}
