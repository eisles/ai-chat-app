export const runtime = "nodejs";

const STOP_WORDS = (process.env.CHAT_RECOMMEND_STOP_WORDS ?? "")
  .split(",")
  .map((w) => w.trim())
  .filter((w) => w.length > 0);

export function GET() {
  return Response.json({ stopWords: STOP_WORDS });
}
