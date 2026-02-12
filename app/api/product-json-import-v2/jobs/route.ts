import { listImportJobsV2 } from "@/lib/product-json-import-v2";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function parseLimit(value: string | null) {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const jobs = await listImportJobsV2(limit);
    return Response.json({ ok: true, jobs });
  } catch (error) {
    return errorResponse(error);
  }
}
