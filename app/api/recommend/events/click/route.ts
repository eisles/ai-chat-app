import { insertClickEvent } from "@/lib/recommend-personalization/repository";

export const runtime = "nodejs";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Payload = {
  userId?: unknown;
  productId?: unknown;
  cityCode?: unknown;
  source?: unknown;
  score?: unknown;
  metadata?: unknown;
};

function parseUserId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("userIdが必要です", 400);
  }
  const trimmed = value.trim();
  if (!UUID_V4_REGEX.test(trimmed)) {
    throw new ApiError("userIdはUUID v4形式で指定してください", 400);
  }
  return trimmed;
}

function parseProductId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("productIdが必要です", 400);
  }
  return value.trim();
}

function parseCityCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSource(value: unknown): string {
  if (typeof value !== "string") return "recommend-assistant";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "recommend-assistant";
}

function parseScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "不明なエラー";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;
    const userId = parseUserId(body.userId);
    const productId = parseProductId(body.productId);
    const cityCode = parseCityCode(body.cityCode);
    const source = parseSource(body.source);
    const score = parseScore(body.score);
    const metadata = normalizeMetadata(body.metadata);

    await insertClickEvent({
      userId,
      productId,
      cityCode,
      source,
      score,
      metadata,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
