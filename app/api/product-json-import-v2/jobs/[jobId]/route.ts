import {
  deleteDownstreamForJobV2,
  deleteImportJobV2,
  getImportJobV2,
  requeueImportItemsV2,
  updateImportJobFlagsV2,
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

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function parseCaptionImageInput(value: unknown): "url" | "data_url" | undefined {
  if (value === "url" || value === "data_url") return value;
  return undefined;
}

function parseExistingBehavior(value: unknown): "skip" | "delete_then_insert" | undefined {
  if (value === "skip" || value === "delete_then_insert") return value;
  return undefined;
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }
    const url = new URL(req.url);
    const deleteDownstream = url.searchParams.get("deleteDownstream") === "true";
    let downstreamResult: { productIds: number; deletedText: number; deletedImages: number } | null =
      null;
    if (deleteDownstream) {
      downstreamResult = await deleteDownstreamForJobV2({ jobId });
    }
    const deleted = await deleteImportJobV2(jobId);
    if (!deleted) {
      throw new ApiError("jobが見つかりません", 404);
    }
    return Response.json({ ok: true, downstreamResult });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }
    const payload = (await req.json()) as {
      action?: unknown;
      statuses?: unknown;
      doTextEmbedding?: unknown;
      doImageCaptions?: unknown;
      doImageVectors?: unknown;
      captionImageInput?: unknown;
      existingBehavior?: unknown;
      includeFailed?: unknown;
      includeSkipped?: unknown;
      includeSuccess?: unknown;
    };

    if (payload.action === "requeue") {
      const statuses = parseStatuses(payload.statuses);
      if (statuses.length === 0) {
        throw new ApiError("再処理対象が選択されていません", 400);
      }
      const result = await requeueImportItemsV2({ jobId, statuses });
      const job = await getImportJobV2(jobId);
      return Response.json({ ok: true, result, job });
    }

    if (payload.action === "add_processing") {
      const doTextEmbedding = parseOptionalBoolean(payload.doTextEmbedding) ?? false;
      const doImageCaptions = parseOptionalBoolean(payload.doImageCaptions) ?? false;
      const doImageVectors = parseOptionalBoolean(payload.doImageVectors) ?? false;
      if (!doTextEmbedding && !doImageCaptions && !doImageVectors) {
        throw new ApiError("追加処理が選択されていません", 400);
      }
      const includeFailed = parseOptionalBoolean(payload.includeFailed) ?? false;
      const includeSkipped = parseOptionalBoolean(payload.includeSkipped) ?? true;
      const includeSuccess = parseOptionalBoolean(payload.includeSuccess) ?? true;
      const statuses: Array<"failed" | "skipped" | "success"> = [];
      if (includeFailed) statuses.push("failed");
      if (includeSkipped) statuses.push("skipped");
      if (includeSuccess) statuses.push("success");
      if (statuses.length === 0) {
        throw new ApiError("再処理対象が選択されていません", 400);
      }
      const updated = await updateImportJobFlagsV2({
        jobId,
        existingBehavior: parseExistingBehavior(payload.existingBehavior),
        doTextEmbedding,
        doImageCaptions,
        doImageVectors,
        captionImageInput: parseCaptionImageInput(payload.captionImageInput),
      });
      if (!updated) {
        throw new ApiError("jobが見つかりません", 404);
      }
      const result = await requeueImportItemsV2({ jobId, statuses });
      const job = await getImportJobV2(jobId);
      return Response.json({ ok: true, result, job });
    }

    throw new ApiError("actionが不正です", 400);
  } catch (error) {
    return errorResponse(error);
  }
}
