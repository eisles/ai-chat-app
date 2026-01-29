import {
  createImportJob,
  getFailedItems,
  getImportJob,
  getProcessingItems,
} from "@/lib/product-json-import";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type CsvRow = Record<string, string>;

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

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("CSV file is required", 400);
    }

    const content = await file.text();
    const rows = mapCsvRows(parseCsv(content));
    if (rows.length === 0) {
      throw new ApiError("CSV has no rows", 400);
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

    const jobId = await createImportJob({ items, invalidCount });
    const job = await getImportJob(jobId);
    const failedItems = await getFailedItems(jobId, 5);
    const processingItems = await getProcessingItems(jobId, 5);

    return Response.json({
      ok: true,
      job,
      failedItems,
      processingItems,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return Response.json({ ok: false, error: "jobId is required" }, { status: 400 });
  }
  const job = await getImportJob(jobId);
  if (!job) {
    return Response.json({ ok: false, error: "job not found" }, { status: 404 });
  }
  const failedItems = await getFailedItems(jobId, 5);
  const processingItems = await getProcessingItems(jobId, 5);
  return Response.json({ ok: true, job, failedItems, processingItems });
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
