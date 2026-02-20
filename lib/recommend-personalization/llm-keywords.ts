import { createCompletion } from "@/lib/llm-providers";

const MODEL = process.env.RECOMMEND_PERSONALIZATION_LLM_MODEL ?? "openai:gpt-4o-mini";
const SYSTEM_PROMPT =
  "以下の商品説明からユーザーの嗜好を表す日本語キーワードを抽出し、JSON配列のみで返してください。" +
  "最大10件。抽象的すぎる語や助詞は除外。";

function parseKeywords(content: string): string[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
    } catch {
      // JSONとして読めない場合はフォールバック
    }
  }

  return content
    .split(/[\n,、]+/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 10);
}

export async function generatePreferenceKeywordsByLlm(
  clickedTexts: string[]
): Promise<string[]> {
  if (clickedTexts.length === 0) return [];

  try {
    const response = await createCompletion({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: clickedTexts.join("\n\n") },
      ],
      temperature: 0.2,
      maxTokens: 200,
    });
    return parseKeywords(response.content);
  } catch {
    return [];
  }
}
