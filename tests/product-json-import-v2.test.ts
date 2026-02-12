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
    // 簡易モック: `returning id` を使う更新だけ、戻り値が必要なケースがある
    if (
      sql.includes("update public.product_import_items_v2") &&
      sql.includes("set status = 'skipped'") &&
      sql.includes("returning id")
    ) {
      return [{ id: "00000000-0000-0000-0000-000000000001" }];
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
  createImportJobV2,
  deleteDownstreamForJobV2,
  getQueueStatsV2,
  INSERT_IMPORT_ITEMS_BATCH_SIZE,
  markItemsSkippedBulkV2,
  requeueStaleProcessingItemsV2,
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
    await claimPendingItemsV2("00000000-0000-0000-0000-000000000000", 10);
    const call = mockState.calls.find((x) =>
      x.sql.includes("update public.product_import_items_v2")
    );
    expect(call).toBeTruthy();
    expect(call?.sql).toContain("attempt_count = attempt_count + 1");
    expect(call?.sql).toContain("next_retry_at is null or next_retry_at <= now()");
    expect(call?.sql.toLowerCase()).toContain("for update skip locked");
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
});
