import {
  IMPORT_ITEM_STATUSES,
  listImportItemsV2,
  type ImportItemStatusV2,
} from "@/lib/product-json-import-v2";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

function parseOptionalInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized >= 1 ? normalized : null;
}

function parseLimit(value: string | null): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function parseOffset(value: string | null): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function parseOptionalString(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseStatus(value: string | null): ImportItemStatusV2 | null {
  if (!value) return null;
  return IMPORT_ITEM_STATUSES.includes(value as ImportItemStatusV2)
    ? (value as ImportItemStatusV2)
    : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }
    const url = new URL(req.url);
    const rowIndexFrom = parseOptionalInt(url.searchParams.get("rowIndexFrom"));
    const parsedRowIndexTo = parseOptionalInt(url.searchParams.get("rowIndexTo"));
    const rowIndexTo =
      rowIndexFrom !== null &&
      parsedRowIndexTo !== null &&
      parsedRowIndexTo < rowIndexFrom
        ? rowIndexFrom
        : parsedRowIndexTo;
    const result = await listImportItemsV2({
      jobId,
      limit: parseLimit(url.searchParams.get("limit")),
      offset: parseOffset(url.searchParams.get("offset")),
      status: parseStatus(url.searchParams.get("status")),
      rowIndexFrom,
      rowIndexTo,
      cityCode: parseOptionalString(url.searchParams.get("cityCode")),
      productId: parseOptionalString(url.searchParams.get("productId")),
      includeProductJson: url.searchParams.get("includeProductJson") === "true",
    });
    return Response.json({ ok: true, items: result.items, total: result.total });
  } catch (error) {
    return errorResponse(error);
  }
}
