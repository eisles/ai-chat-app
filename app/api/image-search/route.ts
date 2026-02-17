import {
  assertOpenAIError,
  generateTextEmbedding,
  searchTextEmbeddings,
} from "@/lib/image-text-search";
import {
  createCompletion,
  getModelById,
  LLMProviderError,
} from "@/lib/llm-providers";
import { getDb } from "@/lib/neon";
import {
  extractCategoriesFromMetadata,
  getCategoryScoreAdjustment,
  inferCategoryFromKeyword,
} from "@/lib/category-utils";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const DEFAULT_VISION_MODEL = "openai:gpt-4o";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.78;
const VECTORIZE_ENDPOINT = "https://convertvectorapi.onrender.com/vectorize";
const VECTORIZE_DIM = 512;
const TEXT_WEIGHT = 0.6;
const IMAGE_WEIGHT = 0.4;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type SearchOptions = {
  topK: number;
  threshold: number;
  useAmountFilter: boolean;
};

type AmountRange = {
  min?: number | null;
  max?: number | null;
};

type ImageMatch = {
  id: string;
  productId: string | null;
  cityCode: string | null;
  slideIndex: number | null;
  imageUrl: string;
  distance: number;
  imageSimilarity: number;
  imageScore: number;
  metadata: Record<string, unknown> | null;
  amount: number | null;
};

type CombinedMatch = {
  key: string;
  productId: string | null;
  cityCode: string | null;
  slideIndex: number | null;
  text?: string;
  metadata?: Record<string, unknown> | null;
  imageUrl?: string;
  amount?: number | null;
  textScore: number;
  textSimilarity: number;
  imageScore: number;
  imageSimilarity: number;
  imageDistance: number | null;
  textDistance: number | null;
  categoryAdjustment: number;
  score: number;
};

function parseSearchOptions(value: FormDataEntryValue | null): SearchOptions {
  if (!value) {
    return { topK: DEFAULT_TOP_K, threshold: DEFAULT_THRESHOLD, useAmountFilter: true };
  }

  if (typeof value !== "string") {
    throw new ApiError("Invalid options format", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError("Options must be valid JSON", 400);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ApiError("Options must be an object", 400);
  }

  const options = parsed as {
    top_k?: unknown;
    threshold?: unknown;
    use_amount_filter?: unknown;
  };
  const topK =
    typeof options.top_k === "number" && Number.isFinite(options.top_k)
      ? Math.floor(options.top_k)
      : DEFAULT_TOP_K;
  const threshold =
    typeof options.threshold === "number" && Number.isFinite(options.threshold)
      ? options.threshold
      : DEFAULT_THRESHOLD;
  const useAmountFilter =
    typeof options.use_amount_filter === "boolean"
      ? options.use_amount_filter
      : true;

  if (topK <= 0) {
    throw new ApiError("top_k must be positive", 400);
  }
  if (threshold < 0 || threshold > 1) {
    throw new ApiError("threshold must be between 0 and 1", 400);
  }

  return { topK, threshold, useAmountFilter };
}

function isSupportedImageType(contentType: string | undefined) {
  if (!contentType) {
    return false;
  }
  return ["image/png", "image/jpeg", "image/jpg"].includes(contentType);
}

function normalizeImageUrl(value: FormDataEntryValue | null) {
  if (!value) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError("imageUrl must be a string", 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    new URL(trimmed);
  } catch {
    throw new ApiError("imageUrl must be a valid URL", 400);
  }
  return trimmed;
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function downloadImageAsBlob(imageUrl: string) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`Failed to download image: ${res.status} ${body}`, 400);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!isSupportedImageType(contentType)) {
    throw new ApiError("Unsupported image type", 400);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError("Image exceeds size limit", 413);
  }
  const ext = contentType.split("/")[1] ?? "jpg";
  const filename = `image.${ext}`;
  const blob = new Blob([buffer], { type: contentType });
  return { blob, filename };
}

async function generateImageEmbedding(input: {
  file?: File;
  imageUrl?: string;
}) {
  const formData = new FormData();
  if (input.file) {
    formData.append("file", input.file, input.file.name || "image.jpg");
  } else if (input.imageUrl) {
    const { blob, filename } = await downloadImageAsBlob(input.imageUrl);
    formData.append("file", blob, filename);
  } else {
    throw new ApiError("Image file or imageUrl is required", 400);
  }
  formData.append("options", JSON.stringify({ timeout_ms: 20000 }));

  const response = await fetch(VECTORIZE_ENDPOINT, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(`Vectorize API failed: ${response.status} ${body}`, 502);
  }

  const json = (await response.json()) as {
    embedding?: number[];
    model?: string;
    dim?: number;
    normalized?: boolean;
  };

  const vector = json?.embedding;
  if (!vector || !Array.isArray(vector)) {
    throw new ApiError("Invalid embedding response from Vectorize API", 502);
  }
  if (vector.length !== VECTORIZE_DIM) {
    throw new ApiError(
      `Unexpected embedding length: ${vector.length} (expected ${VECTORIZE_DIM})`,
      502
    );
  }

  return {
    vector,
    model: json?.model ?? "vectorize",
    dim: json?.dim ?? vector.length,
    normalized: json?.normalized ?? null,
  };
}

async function imageUrlToDataUrl(imageUrl: string) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`Failed to download image: ${res.status} ${body}`, 400);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!isSupportedImageType(contentType)) {
    throw new ApiError("Unsupported image type", 400);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError("Image exceeds size limit", 413);
  }
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function rankFusionScores<T>(items: T[]): Map<T, number> {
  if (items.length === 0) {
    return new Map();
  }
  return new Map(items.map((item, index) => [item, 1 / (index + 1)]));
}

function normalizeNumberText(value: string): string {
  return value
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xfee0))
    .replaceAll("，", ",")
    .replaceAll("．", ".");
}

function parseYenAmount(rawNumber: string, unit: string | undefined): number | null {
  const normalized = normalizeNumberText(rawNumber).replaceAll(",", "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const multiplier = unit === "万" ? 10000 : 1;
  return Math.round(parsed * multiplier);
}

function extractAmountRangeFromDescription(description: string): AmountRange | null {
  const text = normalizeNumberText(description);
  const numberPattern = "([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(万)?\\s*円?";

  const explicitRange = new RegExp(
    `${numberPattern}\\s*(?:〜|~|\\-|－|—|ー|から)\\s*${numberPattern}`
  );
  const rangeMatch = text.match(explicitRange);
  if (rangeMatch) {
    const first = parseYenAmount(rangeMatch[1] ?? "", rangeMatch[2] ?? undefined);
    const second = parseYenAmount(rangeMatch[3] ?? "", rangeMatch[4] ?? undefined);
    if (first !== null && second !== null) {
      return { min: Math.min(first, second), max: Math.max(first, second) };
    }
  }

  const belowRegex = new RegExp(`${numberPattern}\\s*(?:以下|未満|以内|まで)`);
  const belowMatch = text.match(belowRegex);
  if (belowMatch) {
    const value = parseYenAmount(belowMatch[1] ?? "", belowMatch[2] ?? undefined);
    if (value !== null) {
      return { max: value };
    }
  }

  const aboveRegex = new RegExp(`${numberPattern}\\s*(?:以上|超|より高い|より高額)`);
  const aboveMatch = text.match(aboveRegex);
  if (aboveMatch) {
    const value = parseYenAmount(aboveMatch[1] ?? "", aboveMatch[2] ?? undefined);
    if (value !== null) {
      return { min: value };
    }
  }

  const aroundRegex = new RegExp(`${numberPattern}\\s*(?:くらい|前後|程度|ほど|台)`);
  const aroundMatch = text.match(aroundRegex);
  if (aroundMatch) {
    const value = parseYenAmount(aroundMatch[1] ?? "", aroundMatch[2] ?? undefined);
    if (value !== null) {
      return {
        min: Math.max(0, Math.round(value * 0.85)),
        max: Math.round(value * 1.15),
      };
    }
  }

  const exactRegex = new RegExp(numberPattern);
  const exactMatch = text.match(exactRegex);
  if (exactMatch) {
    const value = parseYenAmount(exactMatch[1] ?? "", exactMatch[2] ?? undefined);
    if (value !== null) {
      return {
        min: Math.max(0, Math.round(value * 0.9)),
        max: Math.round(value * 1.1),
      };
    }
  }

  return null;
}

async function generateCaption(dataUrl: string, model: string) {
  const modelConfig = getModelById(model);
  if (modelConfig && !modelConfig.supportsVision) {
    throw new ApiError(`Model ${model} does not support vision`, 400);
  }

  const response = await createCompletion({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "この画像を日本語で簡潔に説明してください。" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    maxTokens: 256,
    temperature: 0.2,
  });

  const content = response.content;
  if (!content) {
    throw new ApiError("Caption response was empty", 500);
  }

  return content;
}

function errorResponse(trackingId: string, error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      { ok: false, error: error.message, trackingId },
      { status: error.status }
    );
  }

  if (error instanceof LLMProviderError) {
    const status = error.status === 429 ? 429 : error.status >= 500 ? 502 : error.status;
    return Response.json(
      { ok: false, error: error.message, trackingId },
      { status }
    );
  }

  const openAIError = assertOpenAIError(error);
  if (openAIError) {
    const status = openAIError.status === 429 ? 429 : 502;
    return Response.json(
      { ok: false, error: openAIError.message, trackingId },
      { status }
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message, trackingId }, { status: 500 });
}

export async function POST(req: Request) {
  const trackingId = randomUUID();
  const startedAt = Date.now();

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const imageUrl = normalizeImageUrl(formData.get("imageUrl"));

    if (!(file instanceof File) && !imageUrl) {
      throw new ApiError("Image file or imageUrl is required", 400);
    }
    if (file instanceof File && imageUrl) {
      throw new ApiError("Provide either file or imageUrl", 400);
    }
    if (file instanceof File) {
      if (!isSupportedImageType(file.type)) {
        throw new ApiError("Unsupported image type", 400);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new ApiError("Image exceeds size limit", 413);
      }
    }

    const options = parseSearchOptions(formData.get("options"));
    const modelParam = formData.get("model");
    const model = typeof modelParam === "string" && modelParam.includes(":")
      ? modelParam
      : DEFAULT_VISION_MODEL;
    const dataUrl = file instanceof File
      ? await fileToDataUrl(file)
      : await imageUrlToDataUrl(imageUrl!);
    const description = await generateCaption(dataUrl, model);
    const amountRange = extractAmountRangeFromDescription(description);
    const amountFilterApplied = options.useAmountFilter && amountRange !== null;
    const inferredCategory = inferCategoryFromKeyword(description);
    const amountMin = amountFilterApplied ? amountRange?.min ?? null : null;
    const amountMax = amountFilterApplied ? amountRange?.max ?? null : null;
    const embedding = await generateTextEmbedding(description);
    const matches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK: options.topK,
      threshold: options.threshold,
      amountMin,
      amountMax,
    });
    const imageEmbedding = await generateImageEmbedding({
      file: file instanceof File ? file : undefined,
      imageUrl: imageUrl ?? undefined,
    });
    const imageEmbeddingLiteral = `[${imageEmbedding.vector.join(",")}]`;
    const db = getDb();
    await db`create extension if not exists vector`;
    const imageRows = (await db`
      select
        v.id,
        v.city_code,
        v.product_id,
        v.slide_index,
        v.image_url,
        v.embedding <-> ${imageEmbeddingLiteral}::vector as distance,
        t.metadata,
        t.amount
      from public.product_images_vectorize v
      left join lateral (
        select metadata, amount
        from public.product_text_embeddings
        where product_id = v.product_id
          and text_source = 'product_json'
          and (${amountMin}::integer is null or amount >= ${amountMin})
          and (${amountMax}::integer is null or amount <= ${amountMax})
        order by updated_at desc nulls last
        limit 1
      ) t on true
      where (${amountMin}::integer is null or t.amount >= ${amountMin})
        and (${amountMax}::integer is null or t.amount <= ${amountMax})
      order by v.embedding <-> ${imageEmbeddingLiteral}::vector
      limit ${options.topK}
    `) as Array<{
      id: string;
      city_code: string | null;
      product_id: string | null;
      slide_index: number | null;
      image_url: string;
      distance: number;
      metadata: Record<string, unknown> | null;
      amount: number | null;
    }>;
    const imageMatches: ImageMatch[] = imageRows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      cityCode: row.city_code,
      slideIndex: row.slide_index ?? null,
      imageUrl: row.image_url,
      distance: Number(row.distance),
      imageSimilarity: 1 / (1 + Number(row.distance)),
      imageScore: 1 / (1 + Number(row.distance)),
      metadata: row.metadata ?? null,
      amount: row.amount ?? null,
    }));
    const textScoreMap = rankFusionScores(matches);
    const imageScoreMap = rankFusionScores(imageMatches);
    const combinedMap = new Map<string, CombinedMatch>();

    for (const item of matches) {
      const key = item.productId || item.id;
      const textScore = textScoreMap.get(item) ?? 0;
      combinedMap.set(key, {
        key,
        productId: item.productId,
        cityCode: item.cityCode ?? null,
        slideIndex: null,
        text: item.text,
        metadata: item.metadata ?? null,
        textScore,
        textSimilarity: item.score,
        textDistance: 1 - item.score,
        amount: item.amount ?? null,
        imageScore: 0,
        imageSimilarity: 0,
        imageDistance: null,
        categoryAdjustment: 0,
        score: 0,
      });
    }

    for (const item of imageMatches) {
      const key = item.productId ?? item.id;
      const imageScore = imageScoreMap.get(item) ?? 0;
      const existing = combinedMap.get(key);
      const merged: CombinedMatch = {
        key,
        productId: item.productId,
        cityCode: item.cityCode ?? null,
        slideIndex: item.slideIndex ?? null,
        text: existing?.text,
        metadata: existing?.metadata ?? item.metadata ?? null,
        imageUrl: item.imageUrl,
        amount: existing?.amount ?? item.amount ?? null,
        textScore: existing?.textScore ?? 0,
        textSimilarity: existing?.textSimilarity ?? 0,
        textDistance: existing?.textDistance ?? null,
        imageScore,
        imageSimilarity: item.imageSimilarity,
        imageDistance: item.distance,
        categoryAdjustment: 0,
        score: 0,
      };
      const categories = extractCategoriesFromMetadata(merged.metadata ?? null);
      merged.categoryAdjustment = getCategoryScoreAdjustment(
        categories,
        inferredCategory
      );
      merged.score =
        TEXT_WEIGHT * merged.textScore +
        IMAGE_WEIGHT * merged.imageScore +
        merged.categoryAdjustment;
      combinedMap.set(key, merged);
    }

    for (const item of combinedMap.values()) {
      if (item.score !== 0) {
        continue;
      }
      const categories = extractCategoriesFromMetadata(item.metadata ?? null);
      item.categoryAdjustment = getCategoryScoreAdjustment(
        categories,
        inferredCategory
      );
      item.score = TEXT_WEIGHT * item.textScore + item.categoryAdjustment;
    }

    const combinedMatches = [...combinedMap.values()].sort((a, b) => b.score - a.score);
    const elapsedMs = Date.now() - startedAt;

    console.info("image-search", {
      trackingId,
      elapsedMs,
      matches: matches.length,
    });

    return Response.json({
      ok: true,
      trackingId,
      description,
      inferredCategory,
      amountRange,
      amountFilterApplied,
      elapsedMs,
      matches,
      imageMatches,
      combinedMatches,
      weights: { text: TEXT_WEIGHT, image: IMAGE_WEIGHT },
    });
  } catch (error) {
    console.error("image-search failed", { trackingId, error });
    return errorResponse(trackingId, error);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
