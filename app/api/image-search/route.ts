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
};

type CombinedMatch = {
  key: string;
  productId: string | null;
  cityCode: string | null;
  slideIndex: number | null;
  text?: string;
  metadata?: Record<string, unknown> | null;
  imageUrl?: string;
  textScore: number;
  textSimilarity: number;
  imageScore: number;
  imageSimilarity: number;
  imageDistance: number | null;
  textDistance: number | null;
  score: number;
};

function parseSearchOptions(value: FormDataEntryValue | null): SearchOptions {
  if (!value) {
    return { topK: DEFAULT_TOP_K, threshold: DEFAULT_THRESHOLD };
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

  const options = parsed as { top_k?: unknown; threshold?: unknown };
  const topK =
    typeof options.top_k === "number" && Number.isFinite(options.top_k)
      ? Math.floor(options.top_k)
      : DEFAULT_TOP_K;
  const threshold =
    typeof options.threshold === "number" && Number.isFinite(options.threshold)
      ? options.threshold
      : DEFAULT_THRESHOLD;

  if (topK <= 0) {
    throw new ApiError("top_k must be positive", 400);
  }
  if (threshold < 0 || threshold > 1) {
    throw new ApiError("threshold must be between 0 and 1", 400);
  }

  return { topK, threshold };
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
    const embedding = await generateTextEmbedding(description);
    const matches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK: options.topK,
      threshold: options.threshold,
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
        id,
        city_code,
        product_id,
        slide_index,
        image_url,
        embedding <-> ${imageEmbeddingLiteral}::vector as distance
      from public.product_images_vectorize
      order by embedding <-> ${imageEmbeddingLiteral}::vector
      limit ${options.topK}
    `) as Array<{
      id: string;
      city_code: string | null;
      product_id: string | null;
      slide_index: number | null;
      image_url: string;
      distance: number;
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
        imageScore: 0,
        imageSimilarity: 0,
        imageDistance: null,
        score: TEXT_WEIGHT * textScore,
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
        metadata: existing?.metadata,
        imageUrl: item.imageUrl,
        textScore: existing?.textScore ?? 0,
        textSimilarity: existing?.textSimilarity ?? 0,
        textDistance: existing?.textDistance ?? null,
        imageScore,
        imageSimilarity: item.imageSimilarity,
        imageDistance: item.distance,
        score: 0,
      };
      merged.score = TEXT_WEIGHT * merged.textScore + IMAGE_WEIGHT * merged.imageScore;
      combinedMap.set(key, merged);
    }

    const combinedMatches = [...combinedMap.values()].sort(
      (a, b) => b.score - a.score
    );
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
