import {
  deleteQuestionSet,
  updateQuestionSet,
} from "@/lib/recommend-assistant-config/repository";
import {
  isAssistantStepKey,
  type AssistantStepConfig,
} from "@/lib/recommend-assistant-config/types";

export const runtime = "nodejs";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type PatchPayload = {
  name?: unknown;
  steps?: unknown;
  meta?: unknown;
};

type RouteContext = {
  params: { id?: unknown } | Promise<{ id?: unknown }>;
};

function parseId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("invalid id", 400);
  }
  return value.trim();
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await Promise.resolve(context.params);
  return parseId(params?.id);
}

function parseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMeta(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseQuickReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

function parseStep(value: unknown): AssistantStepConfig | null {
  if (!value || typeof value !== "object") return null;
  const step = value as {
    key?: unknown;
    question?: unknown;
    quickReplies?: unknown;
    optional?: unknown;
    enabled?: unknown;
    order?: unknown;
  };

  if (typeof step.key !== "string" || !isAssistantStepKey(step.key)) return null;
  if (typeof step.question !== "string" || step.question.trim().length === 0) return null;

  const order = typeof step.order === "number" && Number.isFinite(step.order) ? step.order : 0;
  return {
    key: step.key,
    question: step.question.trim(),
    quickReplies: parseQuickReplies(step.quickReplies),
    optional: Boolean(step.optional),
    enabled: step.enabled !== false,
    order,
  };
}

function parseSteps(value: unknown): AssistantStepConfig[] | null {
  if (!Array.isArray(value)) return null;
  const steps = value
    .map(parseStep)
    .filter((step): step is AssistantStepConfig => !!step);
  if (steps.length === 0) return null;

  const uniqueKeys = new Set(steps.map((step) => step.key));
  if (uniqueKeys.size !== steps.length) return null;

  return steps;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function PATCH(
  req: Request,
  context: RouteContext
) {
  try {
    const id = await resolveId(context);
    const body = (await req.json()) as PatchPayload;
    const name = parseName(body.name);
    const steps = parseSteps(body.steps);

    if (!name || !steps) {
      throw new ApiError("invalid payload", 400);
    }

    const updated = await updateQuestionSet(id, {
      name,
      steps,
      meta: parseMeta(body.meta),
    });

    if (!updated) {
      return Response.json({ ok: false, error: "set not found" }, { status: 404 });
    }

    return Response.json({ ok: true, set: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _req: Request,
  context: RouteContext
) {
  try {
    const id = await resolveId(context);

    const deleted = await deleteQuestionSet(id);
    if (!deleted) {
      return Response.json(
        { ok: false, error: "set not found or published set cannot be deleted" },
        { status: 404 }
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
