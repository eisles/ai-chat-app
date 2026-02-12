import {
  deleteImportJobV2,
  requeueImportItemsV2,
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

function parseStatuses(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (status) => status === "failed" || status === "skipped" || status === "success"
  ) as Array<"failed" | "skipped" | "success">;
}

export async function DELETE(
  _req: Request,
  { params }: { params: { jobId?: string } }
) {
  try {
    const jobId = params.jobId ?? "";
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }
    const deleted = await deleteImportJobV2(jobId);
    if (!deleted) {
      throw new ApiError("jobが見つかりません", 404);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { jobId?: string } }
) {
  try {
    const jobId = params.jobId ?? "";
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }
    const payload = (await req.json()) as { action?: unknown; statuses?: unknown };
    if (payload.action !== "requeue") {
      throw new ApiError("actionが不正です", 400);
    }
    const statuses = parseStatuses(payload.statuses);
    if (statuses.length === 0) {
      throw new ApiError("再処理対象が選択されていません", 400);
    }
    const result = await requeueImportItemsV2({ jobId, statuses });
    return Response.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
