/**
 * LLM Provider Abstraction Layer
 * Provides unified API for OpenAI, Groq, and Gemini providers
 */

export type LLMProvider = "openai" | "groq" | "gemini";

export type ModelConfig = {
  id: string;           // "provider:model" format
  name: string;         // Human-readable name
  provider: LLMProvider;
  model: string;        // Actual model ID for API calls
  supportsVision: boolean;
};

export const AVAILABLE_MODELS: ModelConfig[] = [
  { id: "openai:gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", model: "gpt-4o-mini", supportsVision: false },
  { id: "openai:gpt-4o", name: "GPT-4o", provider: "openai", model: "gpt-4o", supportsVision: true },
  { id: "groq:llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: "groq", model: "llama-3.1-8b-instant", supportsVision: false },
  { id: "groq:llava-v1.5-7b-4096-preview", name: "LLaVA 1.5 7B", provider: "groq", model: "llava-v1.5-7b-4096-preview", supportsVision: true },
  { id: "gemini:gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini", model: "gemini-2.0-flash", supportsVision: true },
  { id: "gemini:gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", model: "gemini-2.5-flash", supportsVision: true },
];

export function getTextModels(): ModelConfig[] {
  return AVAILABLE_MODELS.filter((m) => !m.supportsVision || m.provider !== "groq");
}

export function getVisionModels(): ModelConfig[] {
  return AVAILABLE_MODELS.filter((m) => m.supportsVision);
}

export function getModelById(id: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id);
}

export function parseModelId(id: string): { provider: LLMProvider; model: string } {
  const parts = id.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid model ID format: ${id}`);
  }
  const [provider, model] = parts;
  if (!["openai", "groq", "gemini"].includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return { provider: provider as LLMProvider, model };
}

export type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: MessageContent;
};

export type CompletionRequest = {
  model: string;  // "provider:model" format
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type CompletionResponse = {
  content: string;
  model: string;
  provider: LLMProvider;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

class LLMProviderError extends Error {
  status: number;
  provider: LLMProvider;

  constructor(message: string, status: number, provider: LLMProvider) {
    super(message);
    this.status = status;
    this.provider = provider;
    this.name = "LLMProviderError";
  }
}

function getApiKey(provider: LLMProvider): string {
  switch (provider) {
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new LLMProviderError("OPENAI_API_KEY is not set", 500, provider);
      return key;
    }
    case "groq": {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new LLMProviderError("GROQ_API_KEY is not set", 500, provider);
      return key;
    }
    case "gemini": {
      const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!key) throw new LLMProviderError("GOOGLE_GENERATIVE_AI_API_KEY is not set", 500, provider);
      return key;
    }
  }
}

async function callOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new LLMProviderError(
      `OpenAI API failed: ${response.status} ${body}`,
      response.status,
      "openai"
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const content = json?.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    content,
    model,
    provider: "openai",
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

async function callGroq(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  // Groq uses OpenAI-compatible API
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new LLMProviderError(
      `Groq API failed: ${response.status} ${body}`,
      response.status,
      "groq"
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const content = json?.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    content,
    model,
    provider: "groq",
    usage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }>;
};

function convertToGeminiFormat(messages: ChatMessage[]): {
  contents: GeminiContent[];
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  const contents: GeminiContent[] = [];

  // システムメッセージがあれば最初のuserメッセージとして追加
  // v1 APIではsystemInstructionがサポートされていないため
  if (systemMessages.length > 0) {
    const systemText = systemMessages
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
      )
      .join("\n");
    contents.push({ role: "user", parts: [{ text: systemText }] });
    // モデルからの空応答を追加（会話の整合性のため）
    contents.push({ role: "model", parts: [{ text: "Understood." }] });
  }

  // 残りのメッセージを変換
  otherMessages.forEach((m) => {
    const role = m.role === "assistant" ? "model" : "user";

    if (typeof m.content === "string") {
      contents.push({ role, parts: [{ text: m.content }] });
      return;
    }

    const parts: GeminiContent["parts"] = m.content.map((part) => {
      if (part.type === "text") {
        return { text: part.text };
      }
      // Handle image_url - extract base64 data
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        const [header, data] = url.split(",");
        const mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
        return { inline_data: { mime_type: mimeType, data } };
      }
      // For external URLs, Gemini requires base64 data
      // This should be pre-converted before calling
      return { text: `[Image URL: ${url}]` };
    });

    contents.push({ role, parts });
  });

  return { contents };
}

async function callGemini(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  const { contents } = convertToGeminiFormat(messages);

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  };

  // gemini-1.5-flash等の新しいモデルはv1betaでのみサポート
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new LLMProviderError(
      `Gemini API failed: ${response.status} ${body}`,
      response.status,
      "gemini"
    );
  }

  const json = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const content =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  return {
    content: content.trim(),
    model,
    provider: "gemini",
    usage: json.usageMetadata
      ? {
          promptTokens: json.usageMetadata.promptTokenCount ?? 0,
          completionTokens: json.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: json.usageMetadata.totalTokenCount ?? 0,
        }
      : undefined,
  };
}

export async function createCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  const { provider, model } = parseModelId(request.model);
  const apiKey = getApiKey(provider);
  const maxTokens = request.maxTokens ?? 256;
  const temperature = request.temperature ?? 0.7;

  switch (provider) {
    case "openai":
      return callOpenAI(apiKey, model, request.messages, maxTokens, temperature);
    case "groq":
      return callGroq(apiKey, model, request.messages, maxTokens, temperature);
    case "gemini":
      return callGemini(apiKey, model, request.messages, maxTokens, temperature);
  }
}

export { LLMProviderError };
