import {
  assertOpenAIError,
  generateTextEmbedding,
  searchTextEmbeddings,
} from "@/lib/image-text-search";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = process.env.OPENAI_CAPTION_MODEL ?? "gpt-4o";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.78;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type SearchOptions = {
  topK: number;
  threshold: number;
};

function parseSearchOptions(value: FormDataEntryValue | null): SearchOptions {
  if (!value) {
    return { topK: DEFAULT_TOP_K, threshold: DEFAULT_THRESHOLD };
  }

  if (typeof value !== "string") {
    throw new ApiError("Invalid options format", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError("Options must be valid JSON", 400);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ApiError("Options must be an object", 400);
  }

  const options = parsed as { top_k?: unknown; threshold?: unknown };
  const topK =
    typeof options.top_k === "number" && Number.isFinite(options.top_k)
      ? Math.floor(options.top_k)
      : DEFAULT_TOP_K;
  const threshold =
    typeof options.threshold === "number" && Number.isFinite(options.threshold)
      ? options.threshold
      : DEFAULT_THRESHOLD;

  if (topK <= 0) {
    throw new ApiError("top_k must be positive", 400);
  }
  if (threshold < 0 || threshold > 1) {
    throw new ApiError("threshold must be between 0 and 1", 400);
  }

  return { topK, threshold };
}

function isSupportedImageType(contentType: string | undefined) {
  if (!contentType) {
    return false;
  }
  return ["image/png", "image/jpeg", "image/jpg"].includes(contentType);
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function generateCaption(dataUrl: string) {
  if (!OPENAI_API_KEY) {
    throw new ApiError("OPENAI_API_KEY is not set", 500);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CAPTION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "この画像を日本語で簡潔に説明してください。" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 256,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(
      `OpenAI caption failed: ${response.status} ${body}`,
      response.status
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new ApiError("OpenAI caption response was empty", 500);
  }

  return content;
}

function errorResponse(trackingId: string, error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      { ok: false, error: error.message, trackingId },
      { status: error.status }
    );
  }

  const openAIError = assertOpenAIError(error);
  if (openAIError) {
    const status = openAIError.status === 429 ? 429 : 502;
    return Response.json(
      { ok: false, error: openAIError.message, trackingId },
      { status }
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ ok: false, error: message, trackingId }, { status: 500 });
}

export async function POST(req: Request) {
  const trackingId = randomUUID();
  const startedAt = Date.now();

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ApiError("Image file is required", 400);
    }
    if (!isSupportedImageType(file.type)) {
      throw new ApiError("Unsupported image type", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError("Image exceeds size limit", 413);
    }

    const options = parseSearchOptions(formData.get("options"));
    const dataUrl = await fileToDataUrl(file);
    const description = await generateCaption(dataUrl);
    const embedding = await generateTextEmbedding(description);
    const matches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK: options.topK,
      threshold: options.threshold,
    });
    const elapsedMs = Date.now() - startedAt;

    console.info("image-search", {
      trackingId,
      elapsedMs,
      matches: matches.length,
    });

    return Response.json({
      ok: true,
      trackingId,
      description,
      elapsedMs,
      matches,
    });
  } catch (error) {
    console.error("image-search failed", { trackingId, error });
    return errorResponse(trackingId, error);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
