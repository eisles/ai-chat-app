import { generateStepDraftsFromMetadata } from "@/lib/recommend-assistant-config/candidate-generator";

export const runtime = "nodejs";

export async function POST() {
  const steps = await generateStepDraftsFromMetadata();
  return Response.json({ ok: true, steps });
}
