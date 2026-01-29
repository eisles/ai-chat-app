import {
  assertOpenAIError,
  generateTextEmbedding,
  searchTextEmbeddings,
} from "@/lib/image-text-search";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KEYWORD_MODEL = process.env.OPENAI_KEYWORD_MODEL ?? "gpt-4o-mini";
const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.6;
const STOP_WORDS = (process.env.CHAT_RECOMMEND_STOP_WORDS ?? "")
  .split(",")
  .map((w) => w.trim())
  .filter((w) => w.length > 0);

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RecommendPayload = {
  history?: unknown;
  topK?: unknown;
  threshold?: unknown;
  useReranking?: unknown;
  stopWords?: unknown;
};

function parseHistory(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("history is required", 400);
  }
  return value.trim();
}

function parseTopK(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return DEFAULT_TOP_K;
}

function parseThreshold(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return DEFAULT_THRESHOLD;
}

function parseUseReranking(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  return true;
}

function parseStopWords(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((w) => String(w).trim()).filter((w) => w.length > 0);
  }
  return STOP_WORDS;
}

async function extractKeywords(history: string) {
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
      model: KEYWORD_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You extract concise Japanese keywords for product recommendation. Return a JSON array of strings.",
        },
        {
          role: "user",
          content: history,
        },
      ],
      max_tokens: 200,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(
      `OpenAI keyword extraction failed: ${response.status} ${body}`,
      response.status
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json?.choices?.[0]?.message?.content?.trim() ?? "";

  const fallback = content
    .split(/[,\n、]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter((item) => item.length > 0);
    }
    if (parsed && typeof parsed === "object" && "keywords" in parsed) {
      const keywords = (parsed as { keywords?: unknown }).keywords;
      if (Array.isArray(keywords)) {
        return keywords.map((item) => String(item)).filter((item) => item.length > 0);
      }
    }
  } catch {
    // fallback to non-JSON parsing
  }

  return fallback;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
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
    const payload = (await req.json()) as RecommendPayload;
    const history = parseHistory(payload.history);
    const topK = parseTopK(payload.topK);
    const threshold = parseThreshold(payload.threshold);
    const useReranking = parseUseReranking(payload.useReranking);
    const stopWords = parseStopWords(payload.stopWords);

    const rawKeywords = useReranking ? await extractKeywords(history) : [];
    const stopWordsSet = new Set(stopWords.map((w) => w.toLowerCase()));
    const keywords = rawKeywords.filter(
      (kw) => !stopWordsSet.has(kw.toLowerCase())
    );
    const embedding = await generateTextEmbedding(history);
    const matches = await searchTextEmbeddings({
      embedding: embedding.vector,
      topK,
      threshold,
    });
    const primaryKeyword = keywords[0]?.trim() ?? "";
    const normalizeText = (value: string) => value.replace(/\s+/g, "");
    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasTerm = (text: string, term: string) => {
      if (!term) return false;
      const escaped = escapeRegExp(term);
      const pattern = `(^|[^\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}])${escaped}([^\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}]|$)`;
      const regex = new RegExp(pattern, "iu");
      return regex.test(text);
    };
    const normalizedPrimary = primaryKeyword ? normalizeText(primaryKeyword) : "";
    const normalizedKeywords = keywords
      .map((keyword) => normalizeText(keyword.trim()))
      .filter((keyword) => keyword.length > 0);

    const reranked = matches
      .map((match) => {
        const text = normalizeText(match.text ?? "");
        let boost = 0;
        if (normalizedPrimary) {
          if (hasTerm(text, normalizedPrimary)) {
            boost += 0.2;
          } else {
            boost -= 0.1;
          }
        }
        for (const keyword of normalizedKeywords) {
          if (keyword && hasTerm(text, keyword)) {
            boost += 0.03;
          }
        }
        return { ...match, score: Number(match.score) + boost };
      })
      .sort((a, b) => b.score - a.score);

    const finalMatches = useReranking ? reranked : matches;

    return Response.json({
      ok: true,
      keywords,
      queryText: history,
      matches: finalMatches,
    });
  } catch (error) {
    return errorResponse(error);
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
