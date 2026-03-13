import {
  claimPendingVectorizeTailItems,
  getImportJobV2,
  getVectorizeTailStats,
  markVectorizeTailItemFailure,
  markVectorizeTailItemSuccess,
  requeueStaleVectorizeTailItems,
} from "@/lib/product-json-import-v2";
import {
  embedOrReuseImageEmbedding,
  upsertProductImagesVectorize,
} from "@/lib/vectorize-product-images";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_VECTOR_TAIL_LIMIT = 20;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_RETRY_DELAY_SECONDS = 60;
const VECTOR_TAIL_STALE_SECONDS = 120;

function parseConcurrency(value: string | undefined, fallback: number, max: number) {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

const VECTOR_TAIL_CONCURRENCY = parseConcurrency(
  process.env.PRODUCT_IMPORT_V2_VECTOR_TAIL_CONCURRENCY,
  1,
  2
);

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RunTailPayload = {
  jobId?: unknown;
  limit?: unknown;
};

function parseLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(100, Math.floor(value)));
  }
  return DEFAULT_VECTOR_TAIL_LIMIT;
}

function normalizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Unknown error";
  return trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
}

function classifyRetry(error: unknown): { retryable: boolean; errorCode: string } {
  if (error instanceof Error && error.name === "AbortError") {
    return { retryable: true, errorCode: "timeout" };
  }
  if (error instanceof TypeError) {
    return { retryable: true, errorCode: "network" };
  }
  return { retryable: false, errorCode: "unknown" };
}

function calcRetryAfterSeconds(attemptCount: number): number {
  const base = Math.max(1, Math.min(attemptCount, 10));
  const seconds = Math.min(MAX_RETRY_DELAY_SECONDS, Math.pow(2, base));
  return Math.max(1, Math.floor(seconds));
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]!();
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
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
    const payload = (await req.json()) as RunTailPayload;
    const jobId = typeof payload.jobId === "string" ? payload.jobId.trim() : "";
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }

    const job = await getImportJobV2(jobId);
    if (!job) {
      throw new ApiError("jobが見つかりません", 404);
    }

    await requeueStaleVectorizeTailItems({
      jobId,
      staleSeconds: VECTOR_TAIL_STALE_SECONDS,
    });

    const items = await claimPendingVectorizeTailItems({
      jobId,
      limit: parseLimit(payload.limit),
    });

    let success = 0;
    let retried = 0;
    let failed = 0;

    await runWithConcurrency(
      items.map((item) => async () => {
        try {
          const embedding = await embedOrReuseImageEmbedding(item.imageUrl);
          await upsertProductImagesVectorize({
            productId: item.productId,
            cityCode: item.cityCode,
            imageUrl: item.imageUrl,
            imageEmbedding: embedding,
            slideIndex: item.slideIndex,
          });
          await markVectorizeTailItemSuccess(item.id);
          success += 1;
        } catch (error) {
          const message = normalizeErrorMessage(
            error instanceof Error ? error.message : String(error)
          );
          const classified = classifyRetry(error);
          const retryable =
            classified.retryable && item.attemptCount < MAX_RETRY_ATTEMPTS;

          await markVectorizeTailItemFailure({
            id: item.id,
            retryable,
            error: message,
            errorCode: classified.errorCode,
            retryAfterSeconds: retryable
              ? calcRetryAfterSeconds(item.attemptCount)
              : undefined,
          });

          if (retryable) {
            retried += 1;
            return;
          }

          failed += 1;
        }
      }),
      VECTOR_TAIL_CONCURRENCY
    );

    const tailStats = await getVectorizeTailStats(jobId);
    return Response.json({
      ok: true,
      processed: items.length,
      success,
      retried,
      failed,
      tailStats,
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
