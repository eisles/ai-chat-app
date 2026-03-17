import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlCall = { sql: string; values: unknown[] };

const mockState = vi.hoisted(() => {
  const calls: SqlCall[] = [];
  const db = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.reduce((acc, part, idx) => {
      const placeholder = idx < values.length ? `$${idx + 1}` : "";
      return `${acc}${part}${placeholder}`;
    }, "");
    calls.push({ sql, values });
    if (
      sql.includes("select distinct product_id") &&
      sql.includes("from public.product_import_items_v2")
    ) {
      return [{ product_id: "1001" }, { product_id: "1002" }];
    }
    if (
      sql.includes("select id") &&
      sql.includes("from public.product_import_items_v2") &&
      sql.includes("status = 'pending'") &&
      sql.includes("order by row_index")
    ) {
      return [{ id: "00000000-0000-0000-0000-000000000002" }];
    }
    if (
      sql.includes("count(*) over() as total_count") &&
      sql.includes("from public.product_import_items_v2")
    ) {
      return [
        {
          id: "00000000-0000-0000-0000-000000000020",
          row_index: 12,
          city_code: "01101",
          product_id: "1001",
          status: "failed",
          attempt_count: 2,
          error: "bad row",
          error_code: "invalid_json",
          current_step: "vectorize",
          next_retry_at: null,
          updated_at: new Date("2026-03-16T06:00:00.000Z"),
          product_json_preview: "{\"id\":\"1001\"}",
          total_count: 1,
        },
      ];
    }
    // 簡易モック: `returning id` を使う更新だけ、戻り値が必要なケースがある
    if (
      sql.includes("update public.product_import_items_v2") &&
      sql.includes("set status = 'skipped'") &&
      sql.includes("returning id")
    ) {
      return [{ id: "00000000-0000-0000-0000-000000000001" }];
    }
    if (
      sql.includes("select id") &&
      sql.includes("from public.product_import_vectorize_tail_items") &&
      sql.includes("status = 'pending'") &&
      sql.includes("order by slide_index, created_at")
    ) {
      return [{ id: "00000000-0000-0000-0000-000000000003" }];
    }
    if (
      sql.includes("update public.product_import_vectorize_tail_items") &&
      sql.includes("set status = 'processing'") &&
      sql.includes("returning") &&
      sql.includes("import_item_id")
    ) {
      return [
        {
          id: "00000000-0000-0000-0000-000000000003",
          job_id: "00000000-0000-0000-0000-000000000000",
          import_item_id: "00000000-0000-0000-0000-000000000010",
          product_id: "1001",
          city_code: "01101",
          image_url: "https://example.com/slide-4.jpg",
          slide_index: 4,
          status: "processing",
          attempt_count: 2,
          next_retry_at: null,
          error: null,
          error_code: null,
          processing_started_at: new Date("2026-03-13T09:00:00.000Z"),
          created_at: new Date("2026-03-13T08:59:00.000Z"),
          updated_at: new Date("2026-03-13T09:00:00.000Z"),
        },
      ];
    }
    if (
      sql.includes("from public.product_import_vectorize_tail_items") &&
      sql.includes("count(*) filter (where status = 'pending') as pending_count")
    ) {
      return [
        {
          pending_count: 2,
          processing_count: 1,
          success_count: 3,
          failed_count: 1,
          next_retry_at: new Date("2026-03-13T10:00:00.000Z"),
        },
      ];
    }
    if (
      sql.includes("select 1") &&
      sql.includes("from public.product_import_vectorize_tail_items") &&
      sql.includes("status in ('pending', 'processing', 'failed')")
    ) {
      return [{ exists: 1 }];
    }
    if (
      sql.includes("select slide_index") &&
      sql.includes("from public.product_images_vectorize") &&
      sql.includes("embedding is not null")
    ) {
      return [{ slide_index: 0 }, { slide_index: 1 }];
    }
    return [];
  };
  return { calls, db };
});

vi.mock("@/lib/neon", () => {
  return {
    getDb: () => mockState.db,
  };
});

import {
  appendImportItemsV2,
  checkExistingVectorizationComplete,
  claimPendingVectorizeTailItems,
  createImportJobV2,
  deleteDownstreamForJobV2,
  enqueueVectorizeTailItems,
  getQueueStatsV2,
  getScopedImportSummaryV2,
  listImportItemsV2,
  getVectorizeTailStats,
  INSERT_IMPORT_ITEMS_BATCH_SIZE,
  markItemsSkippedBulkV2,
  markVectorizeTailItemFailure,
  requeueStaleProcessingItemsV2,
  requeueStaleVectorizeTailItems,
  updateJobStatusV2,
} from "@/lib/product-json-import-v2";
import { claimPendingItemsV2 } from "@/lib/product-json-import-v2";
import { getExistingProductIdsForSources } from "@/lib/image-text-search";
import { getExistingVectorizedProductIds } from "@/lib/vectorize-product-images";

describe("product-json-import-v2", () => {
  beforeEach(() => {
    mockState.calls.length = 0;
  });

  it("creates items with bulk INSERT using UNNEST in batches", async () => {
    const totalItems = INSERT_IMPORT_ITEMS_BATCH_SIZE * 2 + 1;
    const items = Array.from({ length: totalItems }, (_, i) => {
      return {
        rowIndex: i + 2,
        cityCode: null,
        productId: String(1000 + i),
        productJson: "{}",
        status: "pending" as const,
      };
    });

    await createImportJobV2({
      items,
      invalidCount: 0,
      existingBehavior: "skip",
    });

    const itemInsertCalls = mockState.calls.filter((call) =>
      call.sql.includes("insert into public.product_import_items_v2")
    );
    expect(itemInsertCalls.length).toBe(3);
    for (const call of itemInsertCalls) {
      expect(call.sql.toLowerCase()).toContain("from unnest(");
    }

    const jobInsertCalls = mockState.calls.filter((call) =>
      call.sql.includes("insert into public.product_import_jobs_v2")
    );
    expect(jobInsertCalls.length).toBe(1);

    const touchesV1Tables = mockState.calls.some((call) =>
      call.sql.includes("public.product_import_items (")
    );
    expect(touchesV1Tables).toBe(false);
  });

  it("claims pending items with retry window and attempt_count increment", async () => {
    await claimPendingItemsV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      limit: 10,
    });
    const updateCall = mockState.calls.find((x) =>
      x.sql.includes("update public.product_import_items_v2")
    );
    const selectCall = mockState.calls.find((x) =>
      x.sql.includes("from public.product_import_items_v2") &&
      x.sql.includes("next_retry_at is null or next_retry_at <= now()")
    );
    expect(updateCall).toBeTruthy();
    expect(selectCall).toBeTruthy();
    expect(updateCall?.sql).toContain("attempt_count = attempt_count + 1");
  });

  it("lists import items with filter conditions and total count", async () => {
    const result = await listImportItemsV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      limit: 20,
      offset: 40,
      status: "failed",
      rowIndexFrom: 10,
      rowIndexTo: 20,
      cityCode: "01101",
      productId: "1001",
      includeProductJson: true,
    });

    const call = mockState.calls.find((x) => x.sql.includes("count(*) over() as total_count"));
    expect(call).toBeTruthy();
    expect(call?.sql).toContain("status = $");
    expect(call?.sql).toContain("row_index >= $");
    expect(call?.sql).toContain("row_index <= $");
    expect(call?.sql).toContain("city_code = $");
    expect(call?.sql).toContain("product_id = $");
    expect(call?.sql).toContain("offset $");
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "00000000-0000-0000-0000-000000000020",
        rowIndex: 12,
        cityCode: "01101",
        productId: "1001",
        status: "failed",
        attemptCount: 2,
        currentStep: "vectorize",
        error: "bad row",
        errorCode: "invalid_json",
      }),
    ]);
  });

  it("applies row and exact-match filters when claiming pending items", async () => {
    await claimPendingItemsV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      limit: 10,
      filters: {
        rowIndexFrom: 10,
        rowIndexTo: 20,
        cityCode: "01101",
        productId: "1001",
      },
    });

    const selectCall = mockState.calls.find((x) => {
      return (
        x.sql.includes("from public.product_import_items_v2") &&
        x.sql.includes("row_index >= $") &&
        x.sql.includes("row_index <= $") &&
        x.sql.includes("city_code = $") &&
        x.sql.includes("product_id = $")
      );
    });
    expect(selectCall).toBeTruthy();
  });

  it("queries queue stats using filtered counts and next_retry_at", async () => {
    await getQueueStatsV2("00000000-0000-0000-0000-000000000000");
    const call = mockState.calls.find((x) =>
      x.sql.includes("from public.product_import_items_v2")
    );
    expect(call).toBeTruthy();
    expect(call?.sql).toContain("pending_ready_count");
    expect(call?.sql).toContain("pending_delayed_count");
    expect(call?.sql).toContain("min(next_retry_at)");
    expect(call?.sql).toContain("filter");
  });

  it("queries scoped queue stats with run filters", async () => {
    const summary = await getScopedImportSummaryV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      filters: {
        rowIndexFrom: 10,
        rowIndexTo: 20,
        cityCode: "01101",
        productId: "1001",
      },
    });

    const call = mockState.calls.find(
      (x) =>
        x.sql.includes("from public.product_import_items_v2") &&
        x.sql.includes("row_index >= $") &&
        x.sql.includes("row_index <= $") &&
        x.sql.includes("city_code = $") &&
        x.sql.includes("product_id = $")
    );
    expect(call).toBeTruthy();
    expect(summary.totalCount).toBeGreaterThanOrEqual(0);
  });

  it("requeues stale processing items back to pending", async () => {
    await requeueStaleProcessingItemsV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      staleSeconds: 120,
    });
    const call = mockState.calls.find((x) => {
      if (!x.sql.includes("update public.product_import_items_v2")) return false;
      return x.values.some((v) => v === "stale_processing");
    });
    expect(call).toBeTruthy();
    expect(call?.sql).toContain("status = 'processing'");
    expect(call?.sql).toContain("status = 'pending'");
  });

  it("treats jobs as completed when no pending or processing import items remain", async () => {
    await updateJobStatusV2("00000000-0000-0000-0000-000000000000");
    const call = mockState.calls.find((x) =>
      x.sql.includes("update public.product_import_jobs_v2")
    );
    expect(call).toBeTruthy();
    expect(call?.sql).toContain("status in ('pending', 'processing')");
    expect(call?.sql).toContain("not exists");
  });

  it("bulk-skips items and updates job counters", async () => {
    await markItemsSkippedBulkV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      itemIds: ["00000000-0000-0000-0000-000000000001"],
    });

    const updateItems = mockState.calls.find(
      (x) =>
        x.sql.includes("update public.product_import_items_v2") &&
        x.sql.includes("set status = 'skipped'") &&
        x.sql.includes("returning id")
    );
    expect(updateItems).toBeTruthy();

    const updateJob = mockState.calls.find(
      (x) =>
        x.sql.includes("update public.product_import_jobs_v2") &&
        x.sql.includes("skipped_count = skipped_count +")
    );
    expect(updateJob).toBeTruthy();
  });

  it("checks existing product ids for multiple text sources using any()", async () => {
    await getExistingProductIdsForSources({
      productIds: ["5956146", "5956147"],
      sources: ["image_caption", "slide_image_caption_1"],
    });

    const call = mockState.calls.find(
      (x) =>
        x.sql.toLowerCase().includes("select distinct product_id") &&
        x.sql.includes("from product_text_embeddings") &&
        x.sql.includes("text_source = any(")
    );
    expect(call).toBeTruthy();
  });

  it("appends items and increments job counters", async () => {
    await appendImportItemsV2({
      jobId: "00000000-0000-0000-0000-000000000000",
      items: [
        {
          rowIndex: 2,
          cityCode: null,
          productId: "1001",
          productJson: "{}",
          status: "pending",
        },
        {
          rowIndex: 3,
          cityCode: null,
          productId: "1002",
          productJson: "",
          status: "failed",
          error: "product_json is required",
        },
      ],
    });

    const updateJob = mockState.calls.find(
      (x) =>
        x.sql.includes("update public.product_import_jobs_v2") &&
        x.sql.includes("total_count = total_count +")
    );
    expect(updateJob).toBeTruthy();
  });

  it("checks existing vectorized product ids using any()", async () => {
    await getExistingVectorizedProductIds({
      productIds: ["5956146", "5956147"],
    });

    const call = mockState.calls.find(
      (x) =>
        x.sql.toLowerCase().includes("select distinct product_id") &&
        x.sql.includes("from public.product_images_vectorize") &&
        x.sql.includes("product_id = any(")
    );
    expect(call).toBeTruthy();
  });

  it("deletes downstream for job product ids in batches", async () => {
    await deleteDownstreamForJobV2({
      jobId: "00000000-0000-0000-0000-000000000000",
    });

    const textDelete = mockState.calls.find(
      (x) => x.sql.includes("delete from product_text_embeddings")
    );
    expect(textDelete).toBeTruthy();

    const imageDelete = mockState.calls.find(
      (x) => x.sql.includes("delete from public.product_images_vectorize")
    );
    expect(imageDelete).toBeTruthy();
  });

  it("enqueues vector tail items with upsert and stale-slide cleanup", async () => {
    await enqueueVectorizeTailItems({
      jobId: "00000000-0000-0000-0000-000000000000",
      importItemId: "00000000-0000-0000-0000-000000000010",
      productId: "1001",
      cityCode: "01101",
      items: [
        { imageUrl: "https://example.com/slide-4.jpg", slideIndex: 4 },
        { imageUrl: "https://example.com/slide-5.jpg", slideIndex: 5 },
      ],
    });

    const cleanupCall = mockState.calls.find(
      (x) =>
        x.sql.includes("delete from public.product_import_vectorize_tail_items") &&
        x.sql.includes("not (slide_index = any(")
    );
    expect(cleanupCall).toBeTruthy();

    const insertCall = mockState.calls.find(
      (x) =>
        x.sql.includes("insert into public.product_import_vectorize_tail_items") &&
        x.sql.toLowerCase().includes("from unnest(") &&
        x.sql.includes("on conflict (import_item_id, slide_index) do update")
    );
    expect(insertCall).toBeTruthy();
  });

  it("claims pending vector tail items with retry window and attempt_count increment", async () => {
    await claimPendingVectorizeTailItems({
      jobId: "00000000-0000-0000-0000-000000000000",
      limit: 10,
    });

    const updateCall = mockState.calls.find(
      (x) =>
        x.sql.includes("update public.product_import_vectorize_tail_items") &&
        x.sql.includes("attempt_count = attempt_count + 1")
    );
    expect(updateCall).toBeTruthy();
  });

  it("queries vector tail stats", async () => {
    const stats = await getVectorizeTailStats(
      "00000000-0000-0000-0000-000000000000"
    );

    expect(stats).toEqual({
      pendingCount: 2,
      processingCount: 1,
      successCount: 3,
      failedCount: 1,
      nextRetryAt: "2026-03-13T10:00:00.000Z",
    });
  });

  it("requeues stale vector tail items back to pending", async () => {
    await requeueStaleVectorizeTailItems({
      jobId: "00000000-0000-0000-0000-000000000000",
      staleSeconds: 120,
    });

    const call = mockState.calls.find((x) => {
      if (!x.sql.includes("update public.product_import_vectorize_tail_items")) {
        return false;
      }
      return x.values.some((value) => value === "stale_processing");
    });
    expect(call).toBeTruthy();
  });

  it("checks vector completion against slide coverage and tail backlog", async () => {
    const complete = await checkExistingVectorizationComplete({
      productId: "1001",
      expectedSlideIndexes: [0, 1],
    });

    expect(complete).toBe(false);
    const tailCheckCall = mockState.calls.find(
      (x) =>
        x.sql.includes("from public.product_import_vectorize_tail_items") &&
        x.sql.includes("status in ('pending', 'processing', 'failed')")
    );
    expect(tailCheckCall).toBeTruthy();
  });

  it("marks vector tail failure without touching import job counters", async () => {
    await markVectorizeTailItemFailure({
      id: "00000000-0000-0000-0000-000000000003",
      retryable: false,
      error: "boom",
      errorCode: "unknown",
    });

    const tailUpdate = mockState.calls.find(
      (x) =>
        x.sql.includes("update public.product_import_vectorize_tail_items") &&
        x.values.includes("boom")
    );
    expect(tailUpdate).toBeTruthy();

    const jobUpdate = mockState.calls.find(
      (x) => x.sql.includes("update public.product_import_jobs_v2")
    );
    expect(jobUpdate).toBeFalsy();
  });
});
