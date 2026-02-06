/**
 * 既存データから画像キャプションをバックフィル生成するAPI
 *
 * POST /api/product-json-import/backfill-captions
 * - limit: 処理する商品数（デフォルト: 5）
 * - skipExisting: 既存キャプションをスキップ（デフォルト: true）
 *
 * GET /api/product-json-import/backfill-captions
 * - 処理状況の確認
 */

import { getDb } from "@/lib/neon";
import { registerTextEntry } from "@/lib/image-text-search";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = process.env.OPENAI_CAPTION_MODEL ?? "gpt-4o";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT = 5;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type BackfillPayload = {
  limit?: unknown;
  skipExisting?: unknown;
  // フィルタ条件
  cityCode?: unknown;        // 市区町村コード（完全一致）
  cityCodePrefix?: unknown;  // 市区町村コード（前方一致）
  productIdFrom?: unknown;   // 商品ID（この値以上）
  productIdTo?: unknown;     // 商品ID（この値以下）
};

type ProductWithImages = {
  product_id: string;
  city_code: string | null;
  metadata: {
    raw?: {
      image?: string;
      slide_image1?: string;
      slide_image2?: string;
      slide_image3?: string;
      slide_image4?: string;
      slide_image5?: string;
      slide_image6?: string;
      slide_image7?: string;
      slide_image8?: string;
    };
  } | null;
};

type ProcessResult = {
  productId: string;
  processed: number;
  skipped: number;
  errors: string[];
};

function parseLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(50, Math.floor(value)));
  }
  return DEFAULT_LIMIT;
}

function parseSkipExisting(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return true;
}

function isSupportedImageType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  return ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(contentType);
}

async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!isSupportedImageType(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Image exceeds size limit");
  }
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function generateCaption(dataUrl: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CAPTION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "この画像を日本語で簡潔に説明してください。" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 256,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI caption failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI caption response was empty");
  }

  return content;
}

async function checkExistingCaption(
  productId: string,
  source: string
): Promise<boolean> {
  const db = getDb();
  const rows = (await db`
    SELECT 1 FROM product_text_embeddings
    WHERE product_id = ${productId}
      AND text_source = ${source}
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

type ProductFilter = {
  cityCode?: string | null;
  cityCodePrefix?: string | null;
  productIdFrom?: string | null;
  productIdTo?: string | null;
};

async function getProductsWithImages(
  limit: number,
  filter?: ProductFilter
): Promise<ProductWithImages[]> {
  const db = getDb();

  // フィルタ条件を構築
  const cityCode = filter?.cityCode ?? null;
  const cityCodePrefix = filter?.cityCodePrefix ?? null;
  const productIdFrom = filter?.productIdFrom ?? null;
  const productIdTo = filter?.productIdTo ?? null;

  const rows = (await db`
    SELECT DISTINCT ON (product_id)
      product_id,
      city_code,
      metadata
    FROM product_text_embeddings
    WHERE text_source = 'product_json'
      AND metadata IS NOT NULL
      AND metadata->'raw' IS NOT NULL
      AND (
        metadata->'raw'->>'image' IS NOT NULL
        OR metadata->'raw'->>'slide_image1' IS NOT NULL
        OR metadata->'raw'->>'slide_image2' IS NOT NULL
        OR metadata->'raw'->>'slide_image3' IS NOT NULL
        OR metadata->'raw'->>'slide_image4' IS NOT NULL
        OR metadata->'raw'->>'slide_image5' IS NOT NULL
        OR metadata->'raw'->>'slide_image6' IS NOT NULL
        OR metadata->'raw'->>'slide_image7' IS NOT NULL
        OR metadata->'raw'->>'slide_image8' IS NOT NULL
      )
      ${cityCode ? db`AND city_code = ${cityCode}` : db``}
      ${cityCodePrefix ? db`AND city_code LIKE ${cityCodePrefix + '%'}` : db``}
      ${productIdFrom ? db`AND product_id >= ${productIdFrom}` : db``}
      ${productIdTo ? db`AND product_id <= ${productIdTo}` : db``}
    ORDER BY product_id, created_at DESC
    LIMIT ${limit}
  `) as ProductWithImages[];

  return rows;
}

async function getBackfillStats(): Promise<{
  totalProducts: number;
  productsWithImages: number;
  existingCaptions: number;
  pendingCaptions: number;
}> {
  const db = getDb();

  const totalResult = (await db`
    SELECT COUNT(DISTINCT product_id) as count
    FROM product_text_embeddings
    WHERE text_source = 'product_json'
  `) as Array<{ count: string }>;

  const withImagesResult = (await db`
    SELECT COUNT(DISTINCT product_id) as count
    FROM product_text_embeddings
    WHERE text_source = 'product_json'
      AND metadata IS NOT NULL
      AND (
        metadata->'raw'->>'image' IS NOT NULL
        OR metadata->'raw'->>'slide_image1' IS NOT NULL
      )
  `) as Array<{ count: string }>;

  const captionsResult = (await db`
    SELECT COUNT(*) as count
    FROM product_text_embeddings
    WHERE text_source LIKE 'image_caption%'
       OR text_source LIKE 'slide_image_caption%'
  `) as Array<{ count: string }>;

  // 商品数 × 最大9画像 - 既存キャプション数（概算）
  const totalProducts = parseInt(totalResult[0]?.count ?? "0", 10);
  const productsWithImages = parseInt(withImagesResult[0]?.count ?? "0", 10);
  const existingCaptions = parseInt(captionsResult[0]?.count ?? "0", 10);

  return {
    totalProducts,
    productsWithImages,
    existingCaptions,
    pendingCaptions: Math.max(0, productsWithImages - existingCaptions),
  };
}

async function processProductImages(
  product: ProductWithImages,
  skipExisting: boolean
): Promise<ProcessResult> {
  const result: ProcessResult = {
    productId: product.product_id,
    processed: 0,
    skipped: 0,
    errors: [],
  };

  const raw = product.metadata?.raw;
  if (!raw) {
    return result;
  }

  const imageEntries: Array<{ url: string; source: string; slideIndex: number }> = [];

  // メイン画像
  if (raw.image && raw.image.trim()) {
    imageEntries.push({ url: raw.image, source: "image_caption", slideIndex: 0 });
  }

  // スライド画像
  const slideImages = [
    raw.slide_image1,
    raw.slide_image2,
    raw.slide_image3,
    raw.slide_image4,
    raw.slide_image5,
    raw.slide_image6,
    raw.slide_image7,
    raw.slide_image8,
  ];

  slideImages.forEach((url, index) => {
    if (url && url.trim()) {
      imageEntries.push({
        url,
        source: `slide_image_caption_${index + 1}`,
        slideIndex: index + 1,
      });
    }
  });

  for (const entry of imageEntries) {
    // 既存チェック
    if (skipExisting) {
      const exists = await checkExistingCaption(product.product_id, entry.source);
      if (exists) {
        result.skipped++;
        continue;
      }
    }

    try {
      const dataUrl = await imageUrlToDataUrl(entry.url);
      const caption = await generateCaption(dataUrl);

      await registerTextEntry({
        text: caption,
        metadata: {
          source: entry.slideIndex === 0 ? "image_caption" : "slide_image_caption",
          imageUrl: entry.url,
          slideIndex: entry.slideIndex,
        },
        productId: product.product_id,
        cityCode: product.city_code ?? undefined,
        source: entry.source,
        useSourceInHash: true,
      });

      result.processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`${entry.source}: ${message}`);
    }
  }

  return result;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

function parseStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as BackfillPayload;
    const limit = parseLimit(payload.limit);
    const skipExisting = parseSkipExisting(payload.skipExisting);

    // フィルタ条件をパース
    const filter: ProductFilter = {
      cityCode: parseStringOrNull(payload.cityCode),
      cityCodePrefix: parseStringOrNull(payload.cityCodePrefix),
      productIdFrom: parseStringOrNull(payload.productIdFrom),
      productIdTo: parseStringOrNull(payload.productIdTo),
    };

    const products = await getProductsWithImages(limit, filter);

    if (products.length === 0) {
      return Response.json({
        ok: true,
        message: "No products with images found",
        results: [],
        summary: { totalProcessed: 0, totalSkipped: 0, totalErrors: 0 },
      });
    }

    const results: ProcessResult[] = [];

    for (const product of products) {
      const result = await processProductImages(product, skipExisting);
      results.push(result);
    }

    const summary = {
      totalProcessed: results.reduce((sum, r) => sum + r.processed, 0),
      totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    };

    return Response.json({
      ok: true,
      results,
      summary,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const stats = await getBackfillStats();
    return Response.json({
      ok: true,
      stats,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
