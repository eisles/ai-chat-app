/**
 * Reranker - Cross-encoder based reranking
 * Cohere Rerank API または LLM ベースの再ランキング
 */

const COHERE_API_KEY = process.env.COHERE_API_KEY;
const COHERE_RERANK_URL = "https://api.cohere.ai/v1/rerank";

export type RerankDocument = {
  text: string;
  productId: string;
  originalScore: number;
  metadata?: Record<string, unknown> | null;
};

export type RerankResult = {
  productId: string;
  relevanceScore: number;
  originalScore: number;
  combinedScore: number;
  metadata?: Record<string, unknown> | null;
};

/**
 * テキストを指定長に切り詰め
 */
function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Cohere Rerank APIを使用した再ランキング
 * @param query 検索クエリ
 * @param documents 再ランキング対象のドキュメント
 * @param topK 返す件数
 * @returns 再ランキングされた結果
 */
export async function rerankWithCohere(
  query: string,
  documents: RerankDocument[],
  topK: number = 10
): Promise<RerankResult[]> {
  // API キーがない場合はスキップ
  if (!COHERE_API_KEY) {
    console.warn("COHERE_API_KEY not set, skipping reranking");
    return documents.slice(0, topK).map((d) => ({
      productId: d.productId,
      relevanceScore: d.originalScore,
      originalScore: d.originalScore,
      combinedScore: d.originalScore,
      metadata: d.metadata,
    }));
  }

  // ドキュメントが空の場合
  if (documents.length === 0) {
    return [];
  }

  // ドキュメントが少ない場合はそのまま返す
  if (documents.length <= topK) {
    return documents.map((d) => ({
      productId: d.productId,
      relevanceScore: d.originalScore,
      originalScore: d.originalScore,
      combinedScore: d.originalScore,
      metadata: d.metadata,
    }));
  }

  try {
    const response = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${COHERE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "rerank-multilingual-v3.0",
        query,
        documents: documents.map((d) => truncateText(d.text, 4000)),
        top_n: Math.min(topK, documents.length),
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Cohere rerank failed:", response.status, errorText);
      // フォールバック: 元のスコア順で返す
      return documents.slice(0, topK).map((d) => ({
        productId: d.productId,
        relevanceScore: d.originalScore,
        originalScore: d.originalScore,
        combinedScore: d.originalScore,
        metadata: d.metadata,
      }));
    }

    const json = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return json.results.map((r) => {
      const doc = documents[r.index];
      // 元のスコアと再ランキングスコアを組み合わせ（再ランキング重視）
      const combinedScore = r.relevance_score * 0.7 + doc.originalScore * 0.3;
      return {
        productId: doc.productId,
        relevanceScore: r.relevance_score,
        originalScore: doc.originalScore,
        combinedScore,
        metadata: doc.metadata,
      };
    });
  } catch (error) {
    console.error("Cohere rerank error:", error);
    // エラー時はフォールバック
    return documents.slice(0, topK).map((d) => ({
      productId: d.productId,
      relevanceScore: d.originalScore,
      originalScore: d.originalScore,
      combinedScore: d.originalScore,
      metadata: d.metadata,
    }));
  }
}

/**
 * LLMベースの再ランキング（Cohereの代替）
 * GPT-4o-mini を使用してドキュメントの関連性をランキング
 */
export async function rerankWithLLM(
  query: string,
  documents: RerankDocument[],
  topK: number = 10,
  llmClient: {
    createCompletion: (options: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      maxTokens: number;
      temperature: number;
    }) => Promise<{ content: string }>;
  }
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  // ドキュメントが少ない場合はそのまま返す
  if (documents.length <= topK) {
    return documents.map((d) => ({
      productId: d.productId,
      relevanceScore: d.originalScore,
      originalScore: d.originalScore,
      combinedScore: d.originalScore,
      metadata: d.metadata,
    }));
  }

  // 最大20件に制限（LLMのコンテキスト制限のため）
  const docsForLLM = documents.slice(0, 20).map((d, i) => ({
    index: i,
    text: truncateText(d.text, 200),
  }));

  const prompt = `Query: "${query}"

Documents:
${docsForLLM.map((d) => `[${d.index}] ${d.text}`).join("\n")}

Rank the documents by relevance to the query. Return ONLY a JSON array of indices in order of relevance (most relevant first):
[index1, index2, index3, ...]`;

  try {
    const response = await llmClient.createCompletion({
      model: "openai:gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 200,
      temperature: 0,
    });

    const match = response.content.match(/\[[\d,\s]+\]/);
    if (!match) throw new Error("Invalid LLM response");

    const rankedIndices = JSON.parse(match[0]) as number[];
    const validIndices = rankedIndices.filter(
      (i) => typeof i === "number" && i >= 0 && i < documents.length
    );

    return validIndices.slice(0, topK).map((idx, rank) => {
      const doc = documents[idx];
      const relevanceScore = 1 - rank / validIndices.length;
      return {
        productId: doc.productId,
        relevanceScore,
        originalScore: doc.originalScore,
        combinedScore: relevanceScore * 0.7 + doc.originalScore * 0.3,
        metadata: doc.metadata,
      };
    });
  } catch (error) {
    console.error("LLM rerank error:", error);
    return documents.slice(0, topK).map((d) => ({
      productId: d.productId,
      relevanceScore: d.originalScore,
      originalScore: d.originalScore,
      combinedScore: d.originalScore,
      metadata: d.metadata,
    }));
  }
}

/**
 * 再ランキングが利用可能か確認
 */
export function isRerankingAvailable(): boolean {
  return Boolean(COHERE_API_KEY);
}
