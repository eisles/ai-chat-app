import {
  assertOpenAIError,
  registerTextEntry,
  type TextMetadata,
} from "@/lib/image-text-search";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type BulkPayload = {
  items?: unknown;
};

type BulkItem = {
  text?: unknown;
  metadata?: unknown;
  productId?: unknown;
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

function parseProductId(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  throw new ApiError("productId must be a string or number", 400);
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
    const payload = (await req.json()) as BulkPayload;
    if (!payload.items || !Array.isArray(payload.items)) {
      throw new ApiError("items is required", 400);
    }
    if (payload.items.length === 0) {
      throw new ApiError("items must not be empty", 400);
    }

    let stored = 0;
    let skipped = 0;

    for (const rawItem of payload.items) {
      const item = rawItem as BulkItem;
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text) {
        throw new ApiError("each item requires text", 400);
      }

      const metadata = parseMetadata(item.metadata);
      const productId = parseProductId(item.productId);
      const result = await registerTextEntry({ text, metadata, productId });
      if (result.status === "stored") {
        stored += 1;
      } else {
        skipped += 1;
      }
    }

    return Response.json({ ok: true, stored, skipped });
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
