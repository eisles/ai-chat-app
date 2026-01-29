import { getDb } from "@/lib/neon";

export const runtime = "nodejs";

type MigratePayload = {
  productIdStart?: unknown;
  productIdEnd?: unknown;
  cityCodeStart?: unknown;
  cityCodeEnd?: unknown;
  dryRun?: unknown;
};

function parseString(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  throw new Error(`${name} must be a string or number`);
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as MigratePayload;
    const productIdStart = parseString(payload.productIdStart, "productIdStart");
    const productIdEnd = parseString(payload.productIdEnd, "productIdEnd");
    const cityCodeStart = parseString(payload.cityCodeStart, "cityCodeStart");
    const cityCodeEnd = parseString(payload.cityCodeEnd, "cityCodeEnd");
    const dryRun = parseBoolean(payload.dryRun);

    const db = getDb();

    // Ensure amount column exists
    await db`
      alter table product_text_embeddings
      add column if not exists amount integer
    `;
    await db`
      create index if not exists product_text_embeddings_amount_idx
        on product_text_embeddings(amount)
    `;

    if (dryRun) {
      // Count only - use tagged template for safety
      const countRows = (await db`
        SELECT COUNT(*) as count
        FROM product_text_embeddings
        WHERE text_source = 'product_json'
          AND metadata->'raw'->>'amount' IS NOT NULL
          AND (${productIdStart}::text IS NULL OR product_id >= ${productIdStart})
          AND (${productIdEnd}::text IS NULL OR product_id <= ${productIdEnd})
          AND (${cityCodeStart}::text IS NULL OR city_code >= ${cityCodeStart})
          AND (${cityCodeEnd}::text IS NULL OR city_code <= ${cityCodeEnd})
      `) as Array<{ count: string }>;
      const count = parseInt(countRows[0]?.count ?? "0", 10);

      return Response.json({
        ok: true,
        dryRun: true,
        targetCount: count,
        updatedCount: 0,
      });
    }

    // Execute update - use tagged template for safety
    const result = await db`
      UPDATE product_text_embeddings
      SET amount = (metadata->'raw'->>'amount')::integer,
          updated_at = now()
      WHERE text_source = 'product_json'
        AND metadata->'raw'->>'amount' IS NOT NULL
        AND (${productIdStart}::text IS NULL OR product_id >= ${productIdStart})
        AND (${productIdEnd}::text IS NULL OR product_id <= ${productIdEnd})
        AND (${cityCodeStart}::text IS NULL OR city_code >= ${cityCodeStart})
        AND (${cityCodeEnd}::text IS NULL OR city_code <= ${cityCodeEnd})
      RETURNING id
    `;
    const updatedCount = Array.isArray(result) ? result.length : 0;

    return Response.json({
      ok: true,
      dryRun: false,
      targetCount: updatedCount,
      updatedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
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
