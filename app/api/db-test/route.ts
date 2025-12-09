import { getDb } from "@/lib/neon";

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db`select now() as now`;

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
