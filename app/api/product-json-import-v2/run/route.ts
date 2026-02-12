import {
  claimPendingItemsV2,
  getImportJobV2,
  markJobStartedV2,
  markItemsSkippedBulkV2,
  markItemFailureV2,
  markItemRetryV2,
  markItemSkippedV2,
  markItemSuccessV2,
  requeueStaleProcessingItemsV2,
  releaseClaimedItemsV2,
  updateJobStatusV2,
} from "@/lib/product-json-import-v2";
import {
  buildProductEmbeddingText,
  checkExistingProductTextSource,
  checkExistingProductTextSourcesAny,
  deleteProductTextEntries,
  getExistingProductIdsForSource,
  getExistingProductIdsForSources,
  registerTextEntry,
  type ProductPayload,
} from "@/lib/image-text-search";
import {
  deleteProductImagesVectorize,
  checkExistingProductImagesVectorize,
  embedWithVectorizeApi,
  getExistingVectorizedProductIds,
  upsertProductImagesVectorize,
} from "@/lib/vectorize-product-images";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = process.env.OPENAI_CAPTION_MODEL ?? "gpt-4o";
const OPENAI_FETCH_TIMEOUT_MS = 15_000;
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const DEFAULT_LIMIT = 5;
const DEFAULT_TIME_BUDGET_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_RETRY_DELAY_SECONDS = 60;
const STALE_PROCESSING_SECONDS = 120;
const HEAVY_WORK_MIN_REMAINING_MS = 6000;

const CAPTION_TEXT_SOURCES = [
  "image_caption",
  "slide_image_caption_1",
  "slide_image_caption_2",
  "slide_image_caption_3",
  "slide_image_caption_4",
  "slide_image_caption_5",
  "slide_image_caption_6",
  "slide_image_caption_7",
  "slide_image_caption_8",
] as const;

function parseConcurrency(value: string | undefined, fallback: number, max: number) {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

// OpenAIは429が出やすいので上げ過ぎない（必要なら環境変数で調整）
const CAPTION_CONCURRENCY = parseConcurrency(
  process.env.PRODUCT_IMPORT_V2_CAPTION_CONCURRENCY,
  4,
  8
);
const TEXT_CONCURRENCY = parseConcurrency(
  process.env.PRODUCT_IMPORT_V2_TEXT_CONCURRENCY,
  2,
  6
);
const VECTORIZE_CONCURRENCY = parseConcurrency(
  process.env.PRODUCT_IMPORT_V2_VECTORIZE_CONCURRENCY,
  2,
  4
);

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RunPayload = {
  jobId?: unknown;
  limit?: unknown;
  timeBudgetMs?: unknown;
  debugTimings?: unknown;
  textConcurrency?: unknown;
  captionConcurrency?: unknown;
  vectorizeConcurrency?: unknown;
};

function parseLimit(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(20, Math.floor(value)));
  }
  return DEFAULT_LIMIT;
}

function parseTimeBudgetMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1000, Math.min(25_000, Math.floor(value)));
  }
  return DEFAULT_TIME_BUDGET_MS;
}

function parseDebugTimings(value: unknown): boolean {
  return value === true;
}

function parseConcurrencyOverride(
  value: unknown,
  fallback: number,
  max: number
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(max, Math.floor(value)));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(max, Math.floor(parsed)));
    }
  }
  return fallback;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isSupportedImageType(contentType: string | undefined) {
  if (!contentType) return false;
  return ["image/png", "image/jpeg", "image/jpg"].includes(contentType);
}

async function imageUrlToDataUrl(imageUrl: string) {
  const res = await fetchWithTimeout(imageUrl, { method: "GET" }, IMAGE_FETCH_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`Failed to download image: ${res.status} ${body}`, 400);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!isSupportedImageType(contentType)) {
    throw new ApiError("Unsupported image type", 400);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError("Image exceeds size limit", 413);
  }
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function generateCaptionFromUrl(imageUrl: string) {
  if (!OPENAI_API_KEY) {
    throw new ApiError("OPENAI_API_KEY is not set", 500);
  }

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: CAPTION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "この画像を日本語で簡潔に説明してください。" },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.2,
      }),
    },
    OPENAI_FETCH_TIMEOUT_MS
  );

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(
      `OpenAI caption failed: ${response.status} ${body}`,
      response.status
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new ApiError("OpenAI caption response was empty", 500);
  }

  return content;
}

async function generateCaptionFromDataUrl(dataUrl: string) {
  // OpenAIのimage_urlはdata URLも受け付ける
  return generateCaptionFromUrl(dataUrl);
}

function normalizeProduct(options: {
  product: ProductPayload;
  productId: string | null;
  cityCode: string | null;
}) {
  const product = { ...options.product };
  if (options.productId) {
    product.id = options.productId;
  }
  if (options.cityCode && !product.city_code) {
    product.city_code = options.cityCode;
  }
  return product;
}

type StepTiming = { step: string; ms: number };
type ItemReport = {
  itemId: string;
  rowIndex: number;
  productId: string | null;
  cityCode: string | null;
  outcome: "success" | "skipped" | "failed" | "retry" | "released";
  attemptCount: number;
  steps: StepTiming[];
  error?: string | null;
  errorCode?: string | null;
  retryAfterSeconds?: number | null;
};

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

async function processProductItem(options: {
  itemId: string;
  productJson: string;
  productId: string | null;
  cityCode: string | null;
  existingBehavior: "skip" | "delete_then_insert";
  doTextEmbedding: boolean;
  doImageCaptions: boolean;
  doImageVectors: boolean;
  captionImageInput: "url" | "data_url";
  captionConcurrency: number;
  vectorizeConcurrency: number;
  knownProductJsonExists?: boolean;
  knownCaptionExists?: boolean;
  knownVectorExists?: boolean;
  debugTimings: boolean;
}): Promise<{ outcome: "processed" | "skipped"; steps: StepTiming[] }> {
  const steps: StepTiming[] = [];
  const timeStep = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    if (!options.debugTimings) return fn();
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      steps.push({ step, ms: Date.now() - startedAt });
    }
  };

  let parsed: unknown;
  try {
    parsed = await timeStep("parse_json", async () => JSON.parse(options.productJson));
  } catch {
    throw new ApiError("product_json is not valid JSON", 400);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ApiError("product_json must be an object", 400);
  }

  const product = normalizeProduct({
    product: parsed as ProductPayload,
    productId: options.productId,
    cityCode: options.cityCode,
  });

  if (product.id === undefined || product.id === null) {
    throw new ApiError("product.id is required", 400);
  }
  if (!product.name && !product.description) {
    throw new ApiError("product.name or product.description is required", 400);
  }

  const productId = String(product.id);
  const slideImageUrls = [
    product.slide_image1 ?? undefined,
    product.slide_image2 ?? undefined,
    product.slide_image3 ?? undefined,
    product.slide_image4 ?? undefined,
    product.slide_image5 ?? undefined,
    product.slide_image6 ?? undefined,
    product.slide_image7 ?? undefined,
    product.slide_image8 ?? undefined,
  ];

  // 既存データの扱い:
  // - skip: 選択した処理（テキスト/キャプション/画像ベクトル）が全て「既に存在」するなら何もしない
  // - delete_then_insert: product_id 単位で downstream を削除してから再登録（存在チェック不要）
  if (options.existingBehavior === "delete_then_insert") {
    await timeStep("delete_downstream_total", async () => {
      await Promise.all([
        deleteProductTextEntries({ productId }),
        deleteProductImagesVectorize({ productId }),
      ]);
    });
  } else {
    const textExists = options.doTextEmbedding
      ? options.knownProductJsonExists ??
        (await checkExistingProductTextSource({
          productId,
          source: "product_json",
        }))
      : true;
    const captionsExist = options.doImageCaptions
      ? options.knownCaptionExists ??
        (await checkExistingProductTextSourcesAny({
          productId,
          sources: [...CAPTION_TEXT_SOURCES],
        }))
      : true;
    const vectorsExist = options.doImageVectors
      ? options.knownVectorExists ??
        (await checkExistingProductImagesVectorize({
          productId,
        }))
      : true;

    if (textExists && captionsExist && vectorsExist) {
      return { outcome: "skipped", steps };
    }
  }

  const tasks: Array<() => Promise<void>> = [];

  if (options.doTextEmbedding) {
    tasks.push(async () => {
      await timeStep("register_product_text", async () => {
        const text = buildProductEmbeddingText(product);
        await registerTextEntry({
          text,
          metadata: { source: "product_json", raw: product },
          productId,
          cityCode: product.city_code ?? undefined,
          source: "product_json",
        });
      });
    });
  }

  if (options.doImageCaptions) {
    tasks.push(async () => {
      const captionTasks: Array<() => Promise<void>> = [];

      // main image
      if (product.image && product.image.trim()) {
        captionTasks.push(async () => {
          try {
            await timeStep("caption_main_image", async () => {
              const caption =
                options.captionImageInput === "data_url"
                  ? await generateCaptionFromDataUrl(
                      await imageUrlToDataUrl(product.image as string)
                    )
                  : await generateCaptionFromUrl(product.image as string);
              await registerTextEntry({
                text: caption,
                metadata: { source: "image_caption", imageUrl: product.image, slideIndex: 0 },
                productId,
                cityCode: product.city_code ?? undefined,
                source: "image_caption",
                useSourceInHash: true,
              });
            });
          } catch (error) {
            console.warn(
              `Failed to process main image for product ${productId}:`,
              error
            );
          }
        });
      }

      // slides
      for (let i = 0; i < slideImageUrls.length; i++) {
        const slideUrl = slideImageUrls[i];
        if (!slideUrl || !slideUrl.trim()) continue;
        const slideIndex = i + 1;
        captionTasks.push(async () => {
          try {
            await timeStep(`caption_slide_${slideIndex}`, async () => {
              const caption =
                options.captionImageInput === "data_url"
                  ? await generateCaptionFromDataUrl(
                      await imageUrlToDataUrl(slideUrl)
                    )
                  : await generateCaptionFromUrl(slideUrl);
              await registerTextEntry({
                text: caption,
                metadata: {
                  source: "slide_image_caption",
                  imageUrl: slideUrl,
                  slideIndex,
                },
                productId,
                cityCode: product.city_code ?? undefined,
                source: `slide_image_caption_${slideIndex}`,
                useSourceInHash: true,
              });
            });
          } catch (error) {
            console.warn(
              `Failed to process slide_image${slideIndex} for product ${productId}:`,
              error
            );
          }
        });
      }

      await timeStep("captions_total", async () => {
        await runWithConcurrency(captionTasks, options.captionConcurrency);
      });
    });
  }

  if (options.doImageVectors) {
    tasks.push(async () => {
      // embed+upsert per image with bounded concurrency
      const vectorTasks: Array<() => Promise<void>> = [];

      const mainUrl = product.image ?? null;
      if (mainUrl && mainUrl.trim()) {
        vectorTasks.push(async () => {
          await timeStep("vectorize_main", async () => {
            const embedding = await embedWithVectorizeApi(mainUrl);
            await upsertProductImagesVectorize({
              productId,
              cityCode: product.city_code ?? null,
              imageUrl: mainUrl,
              imageEmbedding: embedding,
              slideIndex: 0,
            });
          });
        });
      }

      for (let i = 0; i < slideImageUrls.length; i++) {
        const url = slideImageUrls[i];
        if (!url || !url.trim()) continue;
        const slideIndex = i + 1;
        vectorTasks.push(async () => {
          await timeStep(`vectorize_slide_${slideIndex}`, async () => {
            const embedding = await embedWithVectorizeApi(url);
            await upsertProductImagesVectorize({
              productId,
              cityCode: product.city_code ?? null,
              imageUrl: url,
              imageEmbedding: embedding,
              slideIndex,
            });
          });
        });
      }

      await timeStep("vectorize_images_total", async () => {
        await runWithConcurrency(vectorTasks, options.vectorizeConcurrency);
      });
    });
  }

  // delete_then_insert の後の処理はできるだけ同時に進める
  await Promise.all(tasks.map((task) => task()));

  return { outcome: "processed", steps };
}

function normalizeErrorMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "Unknown error";
  return trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
}

function classifyRetry(error: unknown): { retryable: boolean; errorCode: string } {
  if (error instanceof ApiError) {
    if (error.status === 429) return { retryable: true, errorCode: "http_429" };
    if (error.status >= 500 && error.status <= 599) {
      return { retryable: true, errorCode: "http_5xx" };
    }
    return { retryable: false, errorCode: `http_${error.status}` };
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return { retryable: true, errorCode: "timeout" };
    }
    // fetch/network系の一時障害を想定
    if (error instanceof TypeError) {
      return { retryable: true, errorCode: "network" };
    }
  }

  return { retryable: false, errorCode: "unknown" };
}

function calcRetryAfterSeconds(attemptCount: number) {
  // attemptCount は 1,2,3... を想定
  const base = Math.max(1, Math.min(attemptCount, 10));
  const seconds = Math.min(MAX_RETRY_DELAY_SECONDS, Math.pow(2, base));
  return Math.max(1, Math.floor(seconds));
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
    const payload = (await req.json()) as RunPayload;
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
    if (!jobId) {
      throw new ApiError("jobIdが必要です", 400);
    }
    const debugTimings = parseDebugTimings(payload.debugTimings);
    const textConcurrency = parseConcurrencyOverride(
      payload.textConcurrency,
      TEXT_CONCURRENCY,
      6
    );
    const captionConcurrency = parseConcurrencyOverride(
      payload.captionConcurrency,
      CAPTION_CONCURRENCY,
      8
    );
    const vectorizeConcurrency = parseConcurrencyOverride(
      payload.vectorizeConcurrency,
      VECTORIZE_CONCURRENCY,
      4
    );
    const job = await getImportJobV2(jobId);
    if (!job) {
      throw new ApiError("jobが見つかりません", 404);
    }
    if (job.status === "completed") {
      return Response.json({ ok: true, job, processed: 0, retried: 0, released: 0 });
    }

    const limit = parseLimit(payload.limit);
    const timeBudgetMs = parseTimeBudgetMs(payload.timeBudgetMs);
    const deadline = Date.now() + timeBudgetMs;

    await markJobStartedV2(jobId);

    // サーバ側タイムアウト等で processing のまま残った行を救済（再開性の担保）
    await requeueStaleProcessingItemsV2({
      jobId,
      staleSeconds: STALE_PROCESSING_SECONDS,
    });

    let processed = 0;
    let processedThisRun = 0;
    let retried = 0;
    let released = 0;
    const itemReports: ItemReport[] = [];
    const isLightJob = job.doTextEmbedding && !job.doImageCaptions && !job.doImageVectors;

    while (Date.now() <= deadline - 500) {
      const items = await claimPendingItemsV2(jobId, limit);
      if (items.length === 0) {
        break;
      }

      const productIds = items
        .map((item) => item.product_id)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        );

      // skip の場合: product_id がある行はまとめて「既存判定」して早めにスキップできる
      const [existingTextIds, existingCaptionIds, existingVectorIds] =
        job.existingBehavior === "skip"
          ? await Promise.all([
              job.doTextEmbedding
                ? getExistingProductIdsForSource({
                    productIds,
                    source: "product_json",
                  })
                : Promise.resolve(new Set<string>()),
              job.doImageCaptions
                ? getExistingProductIdsForSources({
                    productIds,
                    sources: [...CAPTION_TEXT_SOURCES],
                  })
                : Promise.resolve(new Set<string>()),
              job.doImageVectors
                ? getExistingVectorizedProductIds({
                    productIds,
                  })
                : Promise.resolve(new Set<string>()),
            ])
          : [new Set<string>(), new Set<string>(), new Set<string>()];

      const shouldSkipByDownstream = (productId: string) => {
        if (job.doTextEmbedding && !existingTextIds.has(productId)) return false;
        if (job.doImageCaptions && !existingCaptionIds.has(productId)) return false;
        if (job.doImageVectors && !existingVectorIds.has(productId)) return false;
        return true;
      };

      // 全件スキップが多いケースを高速化（1件ずつmarkしない）
      let skippedIdSet = new Set<string>();
      if (job.existingBehavior === "skip") {
        const skipItemIds = items
          .filter((item) => item.product_id && shouldSkipByDownstream(item.product_id))
          .map((item) => item.id);
        skippedIdSet = new Set(skipItemIds);

        if (skipItemIds.length > 0) {
          const skippedNow = await markItemsSkippedBulkV2({ jobId, itemIds: skipItemIds });
          processed += skippedNow;
          if (debugTimings) {
            for (const item of items) {
              if (!skippedIdSet.has(item.id)) continue;
              itemReports.push({
                itemId: item.id,
                rowIndex: item.row_index,
                productId: item.product_id ?? null,
                cityCode: item.city_code ?? null,
                outcome: "skipped",
                attemptCount: item.attempt_count,
                steps: [{ step: "skip_bulk_by_downstream", ms: 0 }],
              });
            }
          }
        }
      }

      const remainingItems = items.filter((item) => !skippedIdSet.has(item.id));
      if (remainingItems.length === 0) {
        continue;
      }

      if (isLightJob) {
        if (Date.now() > deadline - 500) {
          const remainingIds = remainingItems.map((x) => x.id);
          await releaseClaimedItemsV2({ jobId, itemIds: remainingIds });
          released += remainingIds.length;
          if (debugTimings) {
            for (const remaining of remainingItems) {
              itemReports.push({
                itemId: remaining.id,
                rowIndex: remaining.row_index,
                productId: remaining.product_id ?? null,
                cityCode: remaining.city_code ?? null,
                outcome: "released",
                attemptCount: remaining.attempt_count,
                steps: [{ step: "released_due_to_time_budget", ms: 0 }],
              });
            }
          }
          continue;
        }

        const tasks = remainingItems.map((item) => async () => {
          try {
            const { outcome, steps } = await processProductItem({
              itemId: item.id,
              productJson: item.product_json,
              productId: item.product_id,
              cityCode: item.city_code,
              existingBehavior: job.existingBehavior,
              doTextEmbedding: job.doTextEmbedding,
              doImageCaptions: job.doImageCaptions,
              doImageVectors: job.doImageVectors,
              captionImageInput: job.captionImageInput,
              captionConcurrency,
              vectorizeConcurrency,
              knownProductJsonExists: item.product_id
                ? existingTextIds.has(item.product_id)
                : undefined,
              knownCaptionExists: item.product_id
                ? existingCaptionIds.has(item.product_id)
                : undefined,
              knownVectorExists: item.product_id
                ? existingVectorIds.has(item.product_id)
                : undefined,
              debugTimings,
            });
            if (outcome === "skipped") {
              await markItemSkippedV2({ itemId: item.id, jobId });
              if (debugTimings) {
                itemReports.push({
                  itemId: item.id,
                  rowIndex: item.row_index,
                  productId: item.product_id ?? null,
                  cityCode: item.city_code ?? null,
                  outcome: "skipped",
                  attemptCount: item.attempt_count,
                  steps,
                });
              }
            } else {
              await markItemSuccessV2({ itemId: item.id, jobId });
              if (debugTimings) {
                itemReports.push({
                  itemId: item.id,
                  rowIndex: item.row_index,
                  productId: item.product_id ?? null,
                  cityCode: item.city_code ?? null,
                  outcome: "success",
                  attemptCount: item.attempt_count,
                  steps,
                });
              }
            }
            processed += 1;
            processedThisRun += 1;
          } catch (error) {
            const message = normalizeErrorMessage(
              error instanceof Error ? error.message : "Unknown error"
            );
            const { retryable, errorCode } = classifyRetry(error);

            if (retryable && item.attempt_count < MAX_RETRY_ATTEMPTS) {
              const retryAfterSeconds = calcRetryAfterSeconds(item.attempt_count);
              await markItemRetryV2({
                itemId: item.id,
                jobId,
                error: message,
                errorCode,
                retryAfterSeconds,
              });
              retried += 1;
              if (debugTimings) {
                itemReports.push({
                  itemId: item.id,
                  rowIndex: item.row_index,
                  productId: item.product_id ?? null,
                  cityCode: item.city_code ?? null,
                  outcome: "retry",
                  attemptCount: item.attempt_count,
                  steps: [{ step: "retry_scheduled", ms: 0 }],
                  error: message,
                  errorCode,
                  retryAfterSeconds,
                });
              }
              return;
            }

            await markItemFailureV2({
              itemId: item.id,
              jobId,
              error: message,
              errorCode,
            });
            processed += 1;
            processedThisRun += 1;
            if (debugTimings) {
              itemReports.push({
                itemId: item.id,
                rowIndex: item.row_index,
                productId: item.product_id ?? null,
                cityCode: item.city_code ?? null,
                outcome: "failed",
                attemptCount: item.attempt_count,
                steps: [{ step: "failed", ms: 0 }],
                error: message,
                errorCode,
              });
            }
          }
        });

        await runWithConcurrency(tasks, textConcurrency);
        continue;
      }

      for (let i = 0; i < remainingItems.length; i += 1) {
        const item = remainingItems[i];
        const remainingMs = deadline - Date.now();
        if (Date.now() > deadline - 500) {
          const remainingIds = remainingItems.slice(i).map((x) => x.id);
          await releaseClaimedItemsV2({ jobId, itemIds: remainingIds });
          released += remainingIds.length;
          if (debugTimings) {
            for (const remaining of remainingItems.slice(i)) {
              itemReports.push({
                itemId: remaining.id,
                rowIndex: remaining.row_index,
                productId: remaining.product_id ?? null,
                cityCode: remaining.city_code ?? null,
                outcome: "released",
                attemptCount: remaining.attempt_count,
                steps: [{ step: "released_due_to_time_budget", ms: 0 }],
              });
            }
          }
          break;
        }
        // 重い処理（画像系）を開始するとタイムアウトしやすいので、残り時間が少ない場合は次回に回す
        if (
          remainingMs < HEAVY_WORK_MIN_REMAINING_MS &&
          (job.doImageCaptions || job.doImageVectors) &&
          processedThisRun > 0
        ) {
          const remainingIds = remainingItems.slice(i).map((x) => x.id);
          await releaseClaimedItemsV2({ jobId, itemIds: remainingIds });
          released += remainingIds.length;
          if (debugTimings) {
            for (const remaining of remainingItems.slice(i)) {
              itemReports.push({
                itemId: remaining.id,
                rowIndex: remaining.row_index,
                productId: remaining.product_id ?? null,
                cityCode: remaining.city_code ?? null,
                outcome: "released",
                attemptCount: remaining.attempt_count,
                steps: [{ step: "released_to_avoid_heavy_work_timeout", ms: 0 }],
              });
            }
          }
          break;
        }

        try {
          const { outcome, steps } = await processProductItem({
            itemId: item.id,
            productJson: item.product_json,
            productId: item.product_id,
            cityCode: item.city_code,
            existingBehavior: job.existingBehavior,
            doTextEmbedding: job.doTextEmbedding,
            doImageCaptions: job.doImageCaptions,
            doImageVectors: job.doImageVectors,
            captionImageInput: job.captionImageInput,
            captionConcurrency,
            vectorizeConcurrency,
            knownProductJsonExists: item.product_id
              ? existingTextIds.has(item.product_id)
              : undefined,
            knownCaptionExists: item.product_id
              ? existingCaptionIds.has(item.product_id)
              : undefined,
            knownVectorExists: item.product_id
              ? existingVectorIds.has(item.product_id)
              : undefined,
            debugTimings,
          });
          if (outcome === "skipped") {
            await markItemSkippedV2({ itemId: item.id, jobId });
            if (debugTimings) {
              itemReports.push({
                itemId: item.id,
                rowIndex: item.row_index,
                productId: item.product_id ?? null,
                cityCode: item.city_code ?? null,
                outcome: "skipped",
                attemptCount: item.attempt_count,
                steps,
              });
            }
          } else {
            await markItemSuccessV2({ itemId: item.id, jobId });
            if (debugTimings) {
              itemReports.push({
                itemId: item.id,
                rowIndex: item.row_index,
                productId: item.product_id ?? null,
                cityCode: item.city_code ?? null,
                outcome: "success",
                attemptCount: item.attempt_count,
                steps,
              });
            }
          }
          processed += 1;
          processedThisRun += 1;
        } catch (error) {
          const message = normalizeErrorMessage(
            error instanceof Error ? error.message : "Unknown error"
          );
          const { retryable, errorCode } = classifyRetry(error);

          if (retryable && item.attempt_count < MAX_RETRY_ATTEMPTS) {
            const retryAfterSeconds = calcRetryAfterSeconds(item.attempt_count);
            await markItemRetryV2({
              itemId: item.id,
              jobId,
              error: message,
              errorCode,
              retryAfterSeconds,
            });
            retried += 1;
            if (debugTimings) {
              itemReports.push({
                itemId: item.id,
                rowIndex: item.row_index,
                productId: item.product_id ?? null,
                cityCode: item.city_code ?? null,
                outcome: "retry",
                attemptCount: item.attempt_count,
                steps: [{ step: "retry_scheduled", ms: 0 }],
                error: message,
                errorCode,
                retryAfterSeconds,
              });
            }
            continue;
          }

          await markItemFailureV2({
            itemId: item.id,
            jobId,
            error: message,
            errorCode,
          });
          processed += 1;
          processedThisRun += 1;
          if (debugTimings) {
            itemReports.push({
              itemId: item.id,
              rowIndex: item.row_index,
              productId: item.product_id ?? null,
              cityCode: item.city_code ?? null,
              outcome: "failed",
              attemptCount: item.attempt_count,
              steps: [{ step: "failed", ms: 0 }],
              error: message,
              errorCode,
            });
          }
        }
      }
    }

    await updateJobStatusV2(jobId);
    const nextJob = await getImportJobV2(jobId);
    return Response.json({
      ok: true,
      job: nextJob,
      processed,
      retried,
      released,
      timeBudgetMs,
      itemReports: debugTimings ? itemReports.slice(-50) : undefined,
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
