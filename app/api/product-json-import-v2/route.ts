import {
  appendImportItemsV2,
  createImportJobBaseV2,
  createImportJobV2,
  CAPTION_IMAGE_INPUT_MODES,
  getQueueStatsV2,
  getFailedItemsV2,
  getImportJobV2,
  getProcessingItemsV2,
} from "@/lib/product-json-import-v2";
import {
  parseExistingProductBehavior,
  type ExistingProductBehavior,
} from "@/lib/product-import-behavior";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type CsvRow = Record<string, string>;

type JsonItem = {
  rowIndex: number;
  cityCode: string | null;
  productId: string | null;
  productJson: string;
  status: "pending" | "failed";
  error?: string | null;
};

type CreateJobPayload = {
  action: "create_job";
  totalCount: number;
  invalidCount: number;
  existingBehavior: ExistingProductBehavior;
  doTextEmbedding?: boolean;
  doImageCaptions?: boolean;
  doImageVectors?: boolean;
  captionImageInput?: string | null;
  forcePending?: boolean;
};

type AppendItemsPayload = {
  action: "append_items";
  jobId: string;
  items: JsonItem[];
};

const MAX_APPEND_ITEMS = 2000;

function parseCsv(content: string) {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (next === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      current.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      current.push(cell);
      rows.push(current);
      current = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || current.length > 0) {
    current.push(cell);
    rows.push(current);
  }

  return rows;
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase();
}

function mapCsvRows(rows: string[][]): CsvRow[] {
  if (rows.length === 0) {
    return [];
  }
  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((value) => normalizeHeader(value));

  return dataRows
    .map((row) => {
      const record: CsvRow = {};
      headers.forEach((header, index) => {
        record[header] = (row[index] ?? "").trim();
      });
      return record;
    })
    .filter((record) => Object.values(record).some((value) => value.length > 0));
}

function getColumn(record: CsvRow, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
}

function parseCaptionImageInput(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (CAPTION_IMAGE_INPUT_MODES.includes(normalized as never)) {
    return normalized as (typeof CAPTION_IMAGE_INPUT_MODES)[number];
  }
  return undefined;
}

function parseExistingBehavior(value: unknown): ExistingProductBehavior {
  try {
    return parseExistingProductBehavior(value);
  } catch {
    throw new ApiError("既存データの扱いが不正です", 400);
  }
}

function parseRequiredNumber(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(`${label}が不正です`, 400);
  }
  return Math.max(0, Math.floor(parsed));
}

function parseJsonItem(value: unknown): JsonItem {
  if (!value || typeof value !== "object") {
    throw new ApiError("itemsが不正です", 400);
  }
  const item = value as {
    rowIndex?: unknown;
    cityCode?: unknown;
    productId?: unknown;
    productJson?: unknown;
    status?: unknown;
    error?: unknown;
  };
  const rowIndex = typeof item.rowIndex === "number" ? item.rowIndex : Number(item.rowIndex);
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) {
    throw new ApiError("rowIndexが不正です", 400);
  }
  const status = item.status === "failed" ? "failed" : "pending";
  return {
    rowIndex: Math.floor(rowIndex),
    cityCode: typeof item.cityCode === "string" && item.cityCode.trim()
      ? item.cityCode
      : null,
    productId: typeof item.productId === "string" && item.productId.trim()
      ? item.productId
      : null,
    productJson: typeof item.productJson === "string" ? item.productJson : "",
    status,
    error: typeof item.error === "string" && item.error.trim() ? item.error : null,
  };
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
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await req.json()) as Partial<
        CreateJobPayload | AppendItemsPayload
      >;
      const action = typeof payload.action === "string" ? payload.action : "";
      if (action === "create_job") {
        const totalCount = parseRequiredNumber(
          (payload as CreateJobPayload).totalCount,
          "totalCount"
        );
        const invalidCount = parseRequiredNumber(
          (payload as CreateJobPayload).invalidCount,
          "invalidCount"
        );
        if (invalidCount > totalCount) {
          throw new ApiError("invalidCountがtotalCountを超えています", 400);
        }
        const jobId = await createImportJobBaseV2({
          totalCount,
          invalidCount,
          existingBehavior: parseExistingBehavior(
            (payload as CreateJobPayload).existingBehavior
          ),
          doTextEmbedding: parseBoolean(
            (payload as CreateJobPayload).doTextEmbedding
          ),
          doImageCaptions: parseBoolean(
            (payload as CreateJobPayload).doImageCaptions
          ),
          doImageVectors: parseBoolean(
            (payload as CreateJobPayload).doImageVectors
          ),
          captionImageInput: parseCaptionImageInput(
            (payload as CreateJobPayload).captionImageInput
          ),
          forcePending: parseBoolean(
            (payload as CreateJobPayload).forcePending
          ),
        });
        return Response.json({ ok: true, jobId });
      }
      if (action === "append_items") {
        const jobId =
          typeof (payload as AppendItemsPayload).jobId === "string"
            ? (payload as AppendItemsPayload).jobId
            : "";
        if (!jobId) {
          throw new ApiError("jobIdが必要です", 400);
        }
        if (!Array.isArray((payload as AppendItemsPayload).items)) {
          throw new ApiError("itemsが必要です", 400);
        }
        if ((payload as AppendItemsPayload).items.length === 0) {
          return Response.json({ ok: true, inserted: 0 });
        }
        if ((payload as AppendItemsPayload).items.length > MAX_APPEND_ITEMS) {
          throw new ApiError(`itemsは最大${MAX_APPEND_ITEMS}件までです`, 400);
        }
        const items = (payload as AppendItemsPayload).items.map((item) =>
          parseJsonItem(item)
        );
        await appendImportItemsV2({ jobId, items });
        return Response.json({ ok: true, inserted: items.length });
      }
      throw new ApiError("actionが不正です", 400);
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("CSVファイルが必要です", 400);
    }
    const existingBehavior = parseExistingBehavior(formData.get("existingBehavior"));

    const doTextEmbedding = parseBoolean(formData.get("doTextEmbedding"));
    const doImageCaptions = parseBoolean(formData.get("doImageCaptions"));
    const doImageVectors = parseBoolean(formData.get("doImageVectors"));
    const captionImageInput = parseCaptionImageInput(formData.get("captionImageInput"));

    const content = await file.text();
    const rows = mapCsvRows(parseCsv(content));
    if (rows.length === 0) {
      throw new ApiError("CSVにデータ行がありません", 400);
    }

    let invalidCount = 0;
    const items = rows.map((record, index) => {
      const cityCode = getColumn(record, ["city_code", "city_cd", "citycode"]);
      const productId = getColumn(record, ["product_id", "productid", "id"]);
      const productJson = getColumn(record, ["product_json", "json", "product"]);

      if (!productJson) {
        invalidCount += 1;
        return {
          rowIndex: index + 2,
          cityCode: cityCode || null,
          productId: productId || null,
          productJson: "",
          status: "failed" as const,
          error: "product_json is required",
        };
      }

      return {
        rowIndex: index + 2,
        cityCode: cityCode || null,
        productId: productId || null,
        productJson,
        status: "pending" as const,
      };
    });

    const jobId = await createImportJobV2({
      items,
      invalidCount,
      existingBehavior,
      doTextEmbedding,
      doImageCaptions,
      doImageVectors,
      captionImageInput,
    });
    const job = await getImportJobV2(jobId);
    const failedItems = await getFailedItemsV2(jobId, 5);
    const processingItems = await getProcessingItemsV2(jobId, 5);
    const queueStats = await getQueueStatsV2(jobId);

    return Response.json({
      ok: true,
      job,
      failedItems,
      processingItems,
      queueStats,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return Response.json({ ok: false, error: "jobIdが必要です" }, { status: 400 });
  }
  const job = await getImportJobV2(jobId);
  if (!job) {
    return Response.json({ ok: false, error: "jobが見つかりません" }, { status: 404 });
  }
  const failedItems = await getFailedItemsV2(jobId, 5);
  const processingItems = await getProcessingItemsV2(jobId, 5);
  const queueStats = await getQueueStatsV2(jobId);
  return Response.json({ ok: true, job, failedItems, processingItems, queueStats });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
