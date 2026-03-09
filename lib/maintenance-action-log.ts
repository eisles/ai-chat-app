import { randomUUID } from "node:crypto";

import { parseBasicAuthHeader } from "@/lib/basic-auth";
import { getDb } from "@/lib/neon";

export type MaintenanceLogTarget =
  | "product_images_vectorize"
  | "product_text_embeddings";

export type MaintenanceLogStatus = "success" | "error";

export type MaintenanceActionLogInput = {
  target: MaintenanceLogTarget;
  action: string;
  status: MaintenanceLogStatus;
  actor?: string | null;
  requestSource?: string | null;
  message?: string | null;
  error?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type MaintenanceActionLog = {
  id: string;
  target: MaintenanceLogTarget;
  action: string;
  status: MaintenanceLogStatus;
  actor: string | null;
  requestSource: string | null;
  message: string | null;
  error: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type MaintenanceActionLogRow = {
  id: string;
  target: MaintenanceLogTarget;
  action: string;
  status: MaintenanceLogStatus;
  actor: string | null;
  request_source: string | null;
  message: string | null;
  error: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getForwardedFor(headers: Headers): string | null {
  const forwardedFor = normalizeText(headers.get("x-forwarded-for"));
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }
  return normalizeText(headers.get("x-real-ip"));
}

export function buildMaintenanceRequestLogContext(req: Request): {
  actor: string | null;
  requestSource: string;
  metadata: Record<string, unknown>;
} {
  const url = new URL(req.url);
  const basicAuth = parseBasicAuthHeader(req.headers.get("authorization"));
  const forwardedFor = getForwardedFor(req.headers);
  const actor =
    normalizeText(basicAuth?.username) ??
    normalizeText(req.headers.get("x-maintenance-actor")) ??
    forwardedFor;
  const requestSource =
    normalizeText(req.headers.get("x-maintenance-source")) ??
    `${req.method} ${url.pathname}`;
  const userAgent = normalizeText(req.headers.get("user-agent"));
  const referer = normalizeText(req.headers.get("referer"));

  return {
    actor,
    requestSource,
    metadata: {
      method: req.method,
      pathname: url.pathname,
      userAgent,
      referer,
      forwardedFor,
    },
  };
}

export async function insertMaintenanceActionLog(
  input: MaintenanceActionLogInput
): Promise<{ id: string }> {
  const db = getDb();
  const id = randomUUID();
  const actor = normalizeText(input.actor);
  const requestSource = normalizeText(input.requestSource);
  const message = input.message?.trim() ? input.message.trim() : null;
  const error = input.error?.trim() ? input.error.trim() : null;
  const metadata = normalizeMetadata(input.metadata);

  await db`
    insert into public.maintenance_action_logs (
      id,
      target,
      action,
      status,
      actor,
      request_source,
      message,
      error,
      duration_ms,
      metadata
    )
    values (
      ${id}::uuid,
      ${input.target},
      ${input.action},
      ${input.status},
      ${actor},
      ${requestSource},
      ${message},
      ${error},
      ${input.durationMs ?? null},
      ${metadata}
    )
  `;

  return { id };
}

export async function listMaintenanceActionLogs(
  target: MaintenanceLogTarget,
  limit = 10
): Promise<MaintenanceActionLog[]> {
  const db = getDb();
  let rows: MaintenanceActionLogRow[];

  try {
    rows = (await db`
      select
        id,
        target,
        action,
        status,
        actor,
        request_source,
        message,
        error,
        duration_ms,
        metadata,
        created_at
      from public.maintenance_action_logs
      where target = ${target}
      order by created_at desc
      limit ${limit}
    `) as MaintenanceActionLogRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("maintenance_action_logs")) {
      return [];
    }
    throw error;
  }

  return rows.map((row) => ({
    id: row.id,
    target: row.target,
    action: row.action,
    status: row.status,
    actor: row.actor ?? null,
    requestSource: row.request_source ?? null,
    message: row.message ?? null,
    error: row.error ?? null,
    durationMs: row.duration_ms ?? null,
    metadata: normalizeMetadata(row.metadata),
    createdAt: toIsoString(row.created_at),
  }));
}
