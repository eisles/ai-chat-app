import { getDb } from "@/lib/neon";
import { randomUUID } from "node:crypto";
import {
  isAssistantStepKey,
  type AssistantQuestionSet,
  type AssistantQuestionSetStatus,
  type AssistantStepConfig,
} from "./types";

type DbRow = {
  id: string;
  name: string;
  version: number;
  status: AssistantQuestionSetStatus;
  steps: unknown;
  meta: unknown;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
};

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

async function ensureQuestionSetSchema(): Promise<void> {
  if (schemaReady) return;
  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  const db = getDb();
  schemaPromise = (async () => {
    await db`
      create table if not exists recommend_assistant_question_sets (
        id uuid primary key,
        name text not null,
        version integer not null unique,
        status text not null check (status in ('draft', 'published', 'archived')),
        steps jsonb not null,
        meta jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        published_at timestamptz
      )
    `;
    await db`
      create unique index if not exists recommend_assistant_one_published_idx
      on recommend_assistant_question_sets ((status))
      where status = 'published'
    `;
    schemaReady = true;
  })()
    .finally(() => {
      schemaPromise = null;
    });

  await schemaPromise;
}

function normalizeMeta(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return {};
}

function normalizeQuickReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeStep(value: unknown): AssistantStepConfig | null {
  if (!value || typeof value !== "object") return null;
  const step = value as Partial<AssistantStepConfig>;
  if (!step.key || !isAssistantStepKey(step.key)) return null;
  if (typeof step.question !== "string" || step.question.trim().length === 0) return null;
  const order = typeof step.order === "number" ? step.order : 0;
  return {
    key: step.key,
    question: step.question,
    quickReplies: normalizeQuickReplies(step.quickReplies),
    optional: Boolean(step.optional),
    enabled: step.enabled !== false,
    order,
  };
}

function normalizeSteps(steps: unknown): AssistantStepConfig[] {
  if (!Array.isArray(steps)) return [];
  return steps.map(normalizeStep).filter((step): step is AssistantStepConfig => !!step);
}

function mapRow(row: DbRow): AssistantQuestionSet {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    steps: normalizeSteps(row.steps),
    meta: normalizeMeta(row.meta),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
  };
}

export async function getPublishedQuestionSet(): Promise<AssistantQuestionSet | null> {
  await ensureQuestionSetSchema();
  const db = getDb();
  const rows = (await db`
    select *
    from recommend_assistant_question_sets
    where status = 'published'
    order by published_at desc nulls last
    limit 1
  `) as DbRow[];
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listQuestionSets(): Promise<AssistantQuestionSet[]> {
  await ensureQuestionSetSchema();
  const db = getDb();
  const rows = (await db`
    select *
    from recommend_assistant_question_sets
    order by version desc
  `) as DbRow[];
  return rows.map(mapRow);
}

export async function createDraftSet(input: {
  name: string;
  steps: AssistantStepConfig[];
  meta?: Record<string, unknown>;
}): Promise<AssistantQuestionSet> {
  await ensureQuestionSetSchema();
  const db = getDb();
  const nextVersionRows = (await db`
    select coalesce(max(version), 0) + 1 as next_version
    from recommend_assistant_question_sets
  `) as Array<{ next_version: number }>;
  const nextVersion = nextVersionRows[0]?.next_version ?? 1;

  const rows = (await db`
    insert into recommend_assistant_question_sets (
      id, name, version, status, steps, meta
    )
    values (
      ${randomUUID()}::uuid,
      ${input.name},
      ${nextVersion},
      'draft',
      ${JSON.stringify(input.steps)}::jsonb,
      ${JSON.stringify(input.meta ?? {})}::jsonb
    )
    returning *
  `) as DbRow[];

  return mapRow(rows[0]);
}

export async function publishSet(id: string): Promise<void> {
  await ensureQuestionSetSchema();
  const db = getDb();
  await db`update recommend_assistant_question_sets set status = 'archived' where status = 'published'`;
  await db`
    update recommend_assistant_question_sets
    set status = 'published', published_at = now(), updated_at = now()
    where id = ${id}
  `;
}
