import {
  claimPendingItems,
  getImportJob,
  markItemFailure,
  markItemSuccess,
  updateJobStatus,
} from "@/lib/product-json-import";
import {
  buildProductEmbeddingText,
  registerTextEntry,
  type ProductPayload,
} from "@/lib/image-text-search";
import { vectorizeProductImages } from "@/lib/vectorize-product-images";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = process.env.OPENAI_CAPTION_MODEL ?? "gpt-4o";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT = 2;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RunPayload = {
  jobId?: unknown;
  limit?: unknown;
};

function parseLimit(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(5, Math.floor(value)));
  }
  return DEFAULT_LIMIT;
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

function normalizeProduct(options: {
  product: ProductPayload;
  productId: string | null;
  cityCode: string | null;
}) {
  const product = { ...options.product };
  if (options.productId) {
    product.id = options.productId;
  }
  if (options.cityCode && !product.city_code) {
    product.city_code = options.cityCode;
  }
  return product;
}

async function processProductItem(options: {
  productJson: string;
  productId: string | null;
  cityCode: string | null;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.productJson);
  } catch {
    throw new ApiError("product_json is not valid JSON", 400);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ApiError("product_json must be an object", 400);
  }

  const product = normalizeProduct({
    product: parsed as ProductPayload,
    productId: options.productId,
    cityCode: options.cityCode,
  });

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

  await registerTextEntry({
    text,
    metadata: { source: "product_json", raw: product },
    productId,
    cityCode: product.city_code ?? undefined,
    source: "product_json",
  });

  if (product.image && product.image.trim()) {
    const dataUrl = await imageUrlToDataUrl(product.image);
    const caption = await generateCaption(dataUrl);
    await registerTextEntry({
      text: caption,
      metadata: { source: "image_caption", imageUrl: product.image },
      productId,
      cityCode: product.city_code ?? undefined,
      source: "image_caption",
      useSourceInHash: true,
    });
  }

  await vectorizeProductImages({
    productId,
    cityCode: product.city_code ?? null,
    imageUrl: product.image ?? null,
    slideImageUrls,
  });
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as RunPayload;
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
    if (!jobId) {
      throw new ApiError("jobId is required", 400);
    }
    const job = await getImportJob(jobId);
    if (!job) {
      throw new ApiError("job not found", 404);
    }
    if (job.status === "completed") {
      return Response.json({ ok: true, job, processed: 0 });
    }

    const limit = parseLimit(payload.limit);
    const items = await claimPendingItems(jobId, limit);
    if (items.length === 0) {
      await updateJobStatus(jobId);
      const nextJob = await getImportJob(jobId);
      return Response.json({ ok: true, job: nextJob, processed: 0 });
    }

    for (const item of items) {
      try {
        await processProductItem({
          productJson: item.product_json,
          productId: item.product_id,
          cityCode: item.city_code,
        });
        await markItemSuccess({ itemId: item.id, jobId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await markItemFailure({ itemId: item.id, jobId, error: message });
      }
    }

    await updateJobStatus(jobId);
    const nextJob = await getImportJob(jobId);
    return Response.json({
      ok: true,
      job: nextJob,
      processed: items.length,
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
