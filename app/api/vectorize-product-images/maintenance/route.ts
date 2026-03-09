import {
  isVectorMaintenanceAction,
  runVectorMaintenanceAction,
} from "@/lib/vectorize-product-images-maintenance";

type MaintenancePayload = {
  action?: unknown;
};

export async function POST(req: Request) {
  let payload: MaintenancePayload;

  try {
    payload = (await req.json()) as MaintenancePayload;
  } catch {
    return Response.json(
      { ok: false, error: "JSON ボディが必要です。" },
      { status: 400 }
    );
  }

  if (!isVectorMaintenanceAction(payload.action)) {
    return Response.json(
      { ok: false, error: "action が不正です。" },
      { status: 400 }
    );
  }

  try {
    const result = await runVectorMaintenanceAction(payload.action);
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown maintenance error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
