import { getDb } from "@/lib/neon";
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

type TextRegistrationPayload = {
  text?: unknown;
  metadata?: unknown;
  productId?: unknown;
  cityCode?: unknown;
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

function parseCityCode(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  throw new ApiError("cityCode must be a string or number", 400);
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

async function deleteTextEntryById(id: string) {
  const db = getDb();
  const rows = (await db`
    delete from product_text_embeddings
    where id = ${id}
    returning id
  `) as Array<{ id: string }>;

  return rows[0]?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as TextRegistrationPayload;
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      throw new ApiError("text is required", 400);
    }

    const metadata = parseMetadata(payload.metadata);
    const productId = parseProductId(payload.productId);
    const cityCode = parseCityCode(payload.cityCode);
    const result = await registerTextEntry({
      text,
      metadata,
      productId,
      cityCode,
    });

    return Response.json({
      ok: true,
      id: result.id,
      productId: result.productId,
      cityCode: result.cityCode,
      status: result.status,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      throw new ApiError("id is required", 400);
    }

    const deletedId = await deleteTextEntryById(id);
    if (!deletedId) {
      throw new ApiError("text entry not found", 404);
    }

    return Response.json({ ok: true, id: deletedId });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
