import { publishSet } from "@/lib/recommend-assistant-config/repository";

export const runtime = "nodejs";

type Payload = { id?: unknown };

export async function POST(req: Request) {
  const body = (await req.json()) as Payload;
  if (typeof body.id !== "string" || body.id.trim().length === 0) {
    return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  await publishSet(body.id.trim());
  return Response.json({ ok: true });
}
