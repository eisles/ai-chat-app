import {
  assertOpenAIError,
  buildProductEmbeddingText,
  registerTextEntry,
  type ProductPayload,
  type TextMetadata,
} from "@/lib/image-text-search";
import { vectorizeProductImages } from "@/lib/vectorize-product-images";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = process.env.OPENAI_CAPTION_MODEL ?? "gpt-4o";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type ProductRegistrationPayload = {
  product?: ProductPayload;
  metadata?: unknown;
};

function parseMetadata(value: unknown): TextMetadata | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("metadata must be an object", 400);
  }
  return value as TextMetadata;
}

function parseProduct(value: unknown): ProductPayload {
  if (!value || typeof value !== "object") {
    throw new ApiError("product is required", 400);
  }
  return value as ProductPayload;
}

function isSupportedImageType(contentType: string | undefined) {
  if (!contentType) {
    return false;
  }
  return ["image/png", "image/jpeg", "image/jpg"].includes(contentType);
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

async function generateCaption(dataUrl: string) {
  if (!OPENAI_API_KEY) {
    throw new ApiError("OPENAI_API_KEY is not set", 500);
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
    throw new ApiError(
      `OpenAI caption failed: ${response.status} ${body}`,
      response.status
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new ApiError("OpenAI caption response was empty", 500);
  }

  return content;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }

  const openAIError = assertOpenAIError(error);
  if (openAIError) {
    const status = openAIError.status === 429 ? 429 : 502;
    return Response.json({ ok: false, error: openAIError.message }, { status });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as ProductRegistrationPayload;
    const product = parseProduct(payload.product);
    const metadata = parseMetadata(payload.metadata);

    if (product.id === undefined || product.id === null) {
      throw new ApiError("product.id is required", 400);
    }
    if (!product.name && !product.description) {
      throw new ApiError("product.name or product.description is required", 400);
    }

    const text = buildProductEmbeddingText(product);
    const productId = String(product.id);
    const slideImageUrls = [
      product.slide_image1 ?? undefined,
      product.slide_image2 ?? undefined,
      product.slide_image3 ?? undefined,
      product.slide_image4 ?? undefined,
      product.slide_image5 ?? undefined,
      product.slide_image6 ?? undefined,
      product.slide_image7 ?? undefined,
      product.slide_image8 ?? undefined,
    ];

    const result = await registerTextEntry({
      text,
      metadata: metadata ?? { raw: product },
      productId,
      cityCode: product.city_code ?? undefined,
      source: "product_json",
    });

    let captionStatus: "stored" | "updated" | "skipped" | null = null;
    let captionId: string | null = null;
    if (product.image && product.image.trim()) {
      const dataUrl = await imageUrlToDataUrl(product.image);
      const caption = await generateCaption(dataUrl);
      const captionResult = await registerTextEntry({
        text: caption,
        metadata: { source: "image_caption", imageUrl: product.image },
        productId,
        cityCode: product.city_code ?? undefined,
        source: "image_caption",
        useSourceInHash: true,
      });
      captionStatus = captionResult.status;
      captionId = captionResult.id;
    } else {
      captionStatus = "skipped";
    }

    await vectorizeProductImages({
      productId,
      cityCode: product.city_code ?? null,
      imageUrl: product.image ?? null,
      slideImageUrls,
    });

    return Response.json({
      ok: true,
      id: result.id,
      productId: result.productId,
      cityCode: result.cityCode,
      status: result.status,
      captionStatus,
      captionId,
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
