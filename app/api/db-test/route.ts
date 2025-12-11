import { getDb } from "@/lib/neon";

export async function GET() {
  try {
    const db = getDb();
    const rows = (await db`select now() as now`) as Array<{ now: unknown }>;
    const row = rows[0];

    return Response.json({
      ok: true,
      now: row?.now ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
