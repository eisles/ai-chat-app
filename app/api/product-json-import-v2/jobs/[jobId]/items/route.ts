import { getImportItemsPreviewV2 } from "@/lib/product-json-import-v2";

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
    const limitRaw = url.searchParams.get("limit");
    const parsed = limitRaw ? Number(limitRaw) : NaN;
    const limit = Number.isFinite(parsed) ? Math.floor(parsed) : 10;
    const items = await getImportItemsPreviewV2(jobId, limit);
    return Response.json({ ok: true, items });
  } catch (error) {
    return errorResponse(error);
  }
}
