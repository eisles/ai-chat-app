import { assertOpenAIError } from "@/lib/image-text-search";
import { LLMProviderError } from "@/lib/llm-providers";
import { agentResponseSchema } from "@/lib/recommend-agent/schema";
import { runRecommendAgent } from "@/lib/recommend-agent/service";
import {
  parseThreshold,
  parseTopK,
} from "@/lib/recommend/by-answers-engine";
import type { ConversationSession } from "@/lib/recommend-conversation/types";

export const runtime = "nodejs";

const DEFAULT_TOP_K = 30;
const DEFAULT_THRESHOLD = 0.35;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Payload = {
  session?: unknown;
  topK?: unknown;
  threshold?: unknown;
  userId?: unknown;
  useLlmPersonalization?: unknown;
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function parseUserId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("userIdが必要です", 400);
  }
  const trimmed = value.trim();
  if (!UUID_V4_REGEX.test(trimmed)) {
    throw new ApiError("userIdはUUID v4形式で指定してください", 400);
  }
  return trimmed;
}

function parseSessionSlots(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as ConversationSession["slots"];
  }
  const session = value as ConversationSession;
  if (!session.slots || typeof session.slots !== "object") {
    return {} as ConversationSession["slots"];
  }
  return session.slots;
}

function parseUseLlmPersonalization(value: unknown): boolean {
  return value === true;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }

  if (error instanceof LLMProviderError) {
    const status = error.status === 429 ? 429 : error.status >= 500 ? 502 : error.status;
    return Response.json({ ok: false, error: error.message }, { status });
  }

  const openAIError = assertOpenAIError(error);
  if (openAIError) {
    const status = openAIError.status === 429 ? 429 : 502;
    return Response.json({ ok: false, error: openAIError.message }, { status });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;
    const userId = parseUserId(body.userId);
    const slots = parseSessionSlots(body.session);
    const topK = parseTopK(body.topK, DEFAULT_TOP_K);
    const threshold = parseThreshold(body.threshold, DEFAULT_THRESHOLD);

    const requestUseLlm = parseUseLlmPersonalization(body.useLlmPersonalization);
    const envEnabled = process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED === "true";
    const finalUseLlm = envEnabled && requestUseLlm;
    const result = await runRecommendAgent({
      userId,
      slots,
      topK,
      threshold,
      finalUseLlm,
    });

    const payload = {
      ok: true,
      finalUseLlm,
      ...result,
    };

    const parsed = agentResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "agent response schema validation failed" },
        { status: 500 }
      );
    }

    return Response.json(parsed.data);
  } catch (error) {
    return errorResponse(error);
  }
}
