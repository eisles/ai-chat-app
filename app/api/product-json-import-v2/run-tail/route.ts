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
const DEFAULT_TIME_BUDGET_MS = 25_000;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_RETRY_DELAY_SECONDS = 60;
const VECTOR_TAIL_STALE_SECONDS = 120;
const MAX_VECTOR_TAIL_CONCURRENCY = 2;
const VECTORIZE_TASK_START_INTERVAL_MS = 150;

function parseConcurrency(value: string | undefined, fallback: number, max: number) {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

const VECTOR_TAIL_CONCURRENCY = parseConcurrency(
  process.env.PRODUCT_IMPORT_V2_VECTOR_TAIL_CONCURRENCY,
  1,
  MAX_VECTOR_TAIL_CONCURRENCY
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
  timeBudgetMs?: unknown;
  vectorizeConcurrency?: unknown;
};

function parseConcurrencyOverride(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function lowerConcurrencyOn429(current: number, errorCode: string): number {
  if (errorCode !== "http_429") return current;
  return Math.max(1, current - 1);
}

function parseLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(100, Math.floor(value)));
  }
  return DEFAULT_VECTOR_TAIL_LIMIT;
}

function parseTimeBudgetMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1000, Math.min(25_000, Math.floor(value)));
  }
  return DEFAULT_TIME_BUDGET_MS;
}

function normalizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Unknown error";
  return trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
}

function extractHttpStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  if (error instanceof Error) {
    const match = error.message.match(/\b(?:failed|error):\s*(\d{3})\b/i);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function classifyRetry(error: unknown): { retryable: boolean; errorCode: string } {
  const httpStatus = extractHttpStatus(error);
  if (httpStatus === 429) {
    return { retryable: true, errorCode: "http_429" };
  }
  if (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599) {
    return { retryable: true, errorCode: "http_5xx" };
  }
  if (httpStatus !== null) {
    return { retryable: false, errorCode: `http_${httpStatus}` };
  }
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
  concurrency: number,
  options?: { minStartIntervalMs?: number }
): Promise<T[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let nextStartAt = 0;

  const worker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= tasks.length) return;
      if ((options?.minStartIntervalMs ?? 0) > 0) {
        const now = Date.now();
        const scheduledAt = Math.max(now, nextStartAt);
        nextStartAt = scheduledAt + (options?.minStartIntervalMs ?? 0);
        if (scheduledAt > now) {
          await new Promise((resolve) => setTimeout(resolve, scheduledAt - now));
        }
      }
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
    const requestedVectorizeConcurrency = parseConcurrencyOverride(
      payload.vectorizeConcurrency,
      VECTOR_TAIL_CONCURRENCY,
      MAX_VECTOR_TAIL_CONCURRENCY
    );
    const limit = parseLimit(payload.limit);
    const timeBudgetMs = parseTimeBudgetMs(payload.timeBudgetMs);
    const deadline = Date.now() + timeBudgetMs;

    await requeueStaleVectorizeTailItems({
      jobId,
      staleSeconds: VECTOR_TAIL_STALE_SECONDS,
    });

    let success = 0;
    let retried = 0;
    let failed = 0;
    let processed = 0;
    let http429Count = 0;
    let currentVectorizeConcurrency = requestedVectorizeConcurrency;

    while (Date.now() <= deadline - 500) {
      const items = await claimPendingVectorizeTailItems({
        jobId,
        limit,
      });
      if (items.length === 0) {
        break;
      }

      processed += items.length;
      let batchSaw429 = false;

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
            if (classified.errorCode === "http_429") {
              http429Count += 1;
              batchSaw429 = true;
            }
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
        currentVectorizeConcurrency,
        { minStartIntervalMs: VECTORIZE_TASK_START_INTERVAL_MS }
      );

      if (batchSaw429) {
        currentVectorizeConcurrency = lowerConcurrencyOn429(
          currentVectorizeConcurrency,
          "http_429"
        );
      }
    }

    const tailStats = await getVectorizeTailStats(jobId);
    return Response.json({
      ok: true,
      processed,
      success,
      retried,
      failed,
      http429Count,
      effectiveVectorizeConcurrency: currentVectorizeConcurrency,
      timeBudgetMs,
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
