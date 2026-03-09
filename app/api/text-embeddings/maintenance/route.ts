import {
  buildMaintenanceRequestLogContext,
  insertMaintenanceActionLog,
} from "@/lib/maintenance-action-log";
import {
  isTextEmbeddingsMaintenanceAction,
  runTextEmbeddingsMaintenanceAction,
} from "@/lib/text-embeddings-maintenance";

type MaintenancePayload = {
  action?: unknown;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestContext = buildMaintenanceRequestLogContext(req);
  let payload: MaintenancePayload;

  try {
    payload = (await req.json()) as MaintenancePayload;
  } catch {
    return Response.json(
      { ok: false, error: "JSON ボディが必要です。" },
      { status: 400 }
    );
  }

  if (!isTextEmbeddingsMaintenanceAction(payload.action)) {
    return Response.json(
      { ok: false, error: "action が不正です。" },
      { status: 400 }
    );
  }

  try {
    const result = await runTextEmbeddingsMaintenanceAction(payload.action);
    try {
      await insertMaintenanceActionLog({
        target: "product_text_embeddings",
        action: payload.action,
        status: "success",
        actor: requestContext.actor,
        requestSource: requestContext.requestSource,
        message: result.message,
        durationMs: Date.now() - startedAt,
        metadata: requestContext.metadata,
      });
    } catch {}
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown maintenance error";
    try {
      await insertMaintenanceActionLog({
        target: "product_text_embeddings",
        action: payload.action,
        status: "error",
        actor: requestContext.actor,
        requestSource: requestContext.requestSource,
        error: message,
        durationMs: Date.now() - startedAt,
        metadata: requestContext.metadata,
      });
    } catch {}
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
