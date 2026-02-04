"use client";

import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";

type RRFBreakdown = {
  source: string;
  rank: number;
  contribution: number;
  originalScore: number;
};

type Match = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
  amount: number | null;
  rrfBreakdown?: RRFBreakdown[];
};

type AmountRange = {
  min?: number | null;
  max?: number | null;
};

type SearchStats = {
  queriesExecuted?: number;
  totalCandidates?: number;
  uniqueResults?: number;
  vectorResults?: number;
  keywordResults?: number;
  fulltextResults?: number;
  mergedResults?: number;
  threshold?: number;
};

type ApiResult = {
  ok: boolean;
  keywords?: string[];
  similarKeywords?: string[];
  inferredCategory?: string | null;
  amountRange?: AmountRange | null;
  queryText?: string;
  matches?: Match[];
  searchStats?: SearchStats;
  searchMode?: string;
  reranked?: boolean;
  error?: string;
};

export default function ChatRecommendPage() {
  const [history, setHistory] = useState("");
  const [topK, setTopK] = useState("10");
  const [threshold, setThreshold] = useState("0.6");
  const [useReranking, setUseReranking] = useState(true);
  const [useSimilarSearch, setUseSimilarSearch] = useState(false);
  // 個別検索方式フラグ
  const [useVectorSearch, setUseVectorSearch] = useState(true);
  const [useKeywordSearch, setUseKeywordSearch] = useState(true);
  const [useFullTextSearch, setUseFullTextSearch] = useState(false);
  const [useCategoryBoost, setUseCategoryBoost] = useState(true);
  const [useReranker, setUseReranker] = useState(false);
  const [cohereAvailable, setCohereAvailable] = useState<boolean | null>(null);
  const [stopWordsInput, setStopWordsInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("openai:gpt-4o-mini");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  useEffect(() => {
    // ストップワード取得
    fetch("/api/chat-recommend/stop-words")
      .then((res) => res.json())
      .then((data: { stopWords?: string[] }) => {
        setStopWordsInput((data.stopWords ?? []).join(", "));
      })
      .catch(() => {});

    // Cohere APIの利用可否を取得
    fetch("/api/chat-recommend/status")
      .then((res) => res.json())
      .then((data: { cohereRerankerAvailable?: boolean }) => {
        setCohereAvailable(data.cohereRerankerAvailable ?? false);
      })
      .catch(() => setCohereAvailable(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/chat-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history,
          topK: topK ? Number(topK) : undefined,
          threshold: threshold ? Number(threshold) : undefined,
          useReranking,
          useSimilarSearch,
          useHybridSearch: true,
          // 個別検索方式フラグ
          useVectorSearch,
          useKeywordSearch,
          useFullTextSearch,
          useCategoryBoost,
          useReranker,
          stopWords: stopWordsInput
            .split(",")
            .map((w) => w.trim())
            .filter((w) => w),
          model: selectedModel,
        }),
      });

      let data: ApiResult;
      try {
        data = (await res.json()) as ApiResult;
      } catch {
        data = { ok: false, error: `Failed to parse response (status ${res.status})` };
      }
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Chat History Recommend
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          チャット履歴からレコメンド
        </h1>
        <p className="text-sm text-muted-foreground">
          チャット履歴からキーワードを抽出し、返礼品のテキストベクトルで類似検索します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium">チャット履歴</div>
            <Textarea
              value={history}
              onChange={(event) => setHistory(event.target.value)}
              placeholder="チャットの履歴を貼り付けてください"
              rows={10}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">top_k</div>
              <Input
                value={topK}
                onChange={(event) => setTopK(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">threshold</div>
              <Input
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">基本オプション</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useReranking"
                  checked={useReranking}
                  onChange={(e) => setUseReranking(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="useReranking" className="text-sm font-medium">
                  キーワード抽出
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useSimilarSearch"
                  checked={useSimilarSearch}
                  onChange={(e) => setUseSimilarSearch(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="useSimilarSearch" className="text-sm font-medium">
                  類似キーワード検索
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">検索方式（比較用）</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <div className="flex items-center gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  id="useVectorSearch"
                  checked={useVectorSearch}
                  onChange={(e) => setUseVectorSearch(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="useVectorSearch" className="text-xs font-medium">
                  ベクトル検索
                </label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  id="useKeywordSearch"
                  checked={useKeywordSearch}
                  onChange={(e) => setUseKeywordSearch(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="useKeywordSearch" className="text-xs font-medium">
                  キーワード検索
                </label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  id="useFullTextSearch"
                  checked={useFullTextSearch}
                  onChange={(e) => setUseFullTextSearch(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="useFullTextSearch" className="text-xs font-medium">
                  全文検索
                </label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  id="useCategoryBoost"
                  checked={useCategoryBoost}
                  onChange={(e) => setUseCategoryBoost(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="useCategoryBoost" className="text-xs font-medium">
                  カテゴリブースト
                </label>
              </div>
              <div
                className={`flex items-center gap-2 rounded-md border p-2 ${
                  cohereAvailable === false ? "opacity-50 bg-muted" : ""
                }`}
                title={cohereAvailable === false ? "COHERE_API_KEY が設定されていません" : ""}
              >
                <input
                  type="checkbox"
                  id="useReranker"
                  checked={useReranker}
                  onChange={(e) => setUseReranker(e.target.checked)}
                  disabled={cohereAvailable === false}
                  className="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed"
                />
                <label
                  htmlFor="useReranker"
                  className={`text-xs font-medium ${cohereAvailable === false ? "cursor-not-allowed" : ""}`}
                >
                  Cohereリランカー
                  {cohereAvailable === false && (
                    <span className="ml-1 text-red-500" title="APIキー未設定">⚠</span>
                  )}
                </label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              複数選択でRRF統合。単独選択で各方式の結果を比較できます。
              {cohereAvailable === false && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">
                  ※ Cohereリランカーは COHERE_API_KEY 未設定のため無効です
                </span>
              )}
            </p>
          </div>

          {useReranking && (
            <>
              <div className="space-y-2">
                <div className="text-sm font-medium">LLMモデル</div>
                <ModelSelector
                  value={selectedModel}
                  onChange={setSelectedModel}
                  className="w-full sm:w-64"
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">除外キーワード（カンマ区切り）</div>
                <Input
                  value={stopWordsInput}
                  onChange={(e) => setStopWordsInput(e.target.value)}
                  placeholder="例: ふるさと納税, 返礼品"
                />
              </div>
            </>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-3">
            <div className="font-medium text-sm text-foreground">検索方式の仕様</div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded border bg-blue-50 p-2 dark:bg-blue-950">
                <div className="font-medium text-blue-800 dark:text-blue-200 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-blue-500"></span>
                  ベクトル検索
                </div>
                <ul className="mt-1 space-y-0.5 text-blue-700 dark:text-blue-300">
                  <li>• OpenAI text-embedding-3-small</li>
                  <li>• コサイン類似度で意味的検索</li>
                  <li>• 「お肉」→「牛肉」「豚肉」もヒット</li>
                </ul>
              </div>

              <div className="rounded border bg-green-50 p-2 dark:bg-green-950">
                <div className="font-medium text-green-800 dark:text-green-200 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-green-500"></span>
                  キーワード検索
                </div>
                <ul className="mt-1 space-y-0.5 text-green-700 dark:text-green-300">
                  <li>• pg_trgm + ILIKE</li>
                  <li>• 文字列の部分一致</li>
                  <li>• 「牛肉」→「牛肉」のみヒット</li>
                </ul>
              </div>

              <div className="rounded border bg-yellow-50 p-2 dark:bg-yellow-950">
                <div className="font-medium text-yellow-800 dark:text-yellow-200 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-yellow-500"></span>
                  全文検索
                </div>
                <ul className="mt-1 space-y-0.5 text-yellow-700 dark:text-yellow-300">
                  <li>• PostgreSQL tsvector</li>
                  <li>• 形態素解析ベース</li>
                  <li>• 日本語は効果限定的</li>
                </ul>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="font-medium text-sm text-foreground mb-2">RRFスコアの内訳の見方</div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    vector[4位] +0.0156
                  </span>
                  <span>= ベクトル検索で4番目にヒット、RRFスコアに+0.0156貢献</span>
                </div>
                <div className="mt-2 space-y-0.5">
                  <div>• <strong>RRF計算式</strong>: score = 1 / (k + rank + 1)　※k=60</div>
                  <div>• <strong>1位</strong>: 1/(60+0+1) = 0.0164</div>
                  <div>• <strong>5位</strong>: 1/(60+4+1) = 0.0154</div>
                  <div>• <strong>複数検索でヒット</strong>すると各貢献値が加算され上位に</div>
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="font-medium text-sm text-foreground mb-1">その他のオプション</div>
              <div className="space-y-0.5">
                <div>• <strong>カテゴリブースト</strong>: 推論カテゴリと商品カテゴリが一致で+0.15、不一致で-0.1</div>
                <div>• <strong>Cohereリランカー</strong>: Cohere Rerank API（rerank-multilingual-v3.0）で関連性を再評価。COHERE_API_KEY未設定時は無効</div>
                <div>• <strong>類似キーワード検索</strong>: 「牛肉」→「和牛」「黒毛和牛」「ビーフ」も同時検索</div>
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
            {isSubmitting ? "生成中..." : "キーワード生成して検索"}
          </Button>
        </form>
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">検索結果</h2>
          {result.ok ? (
            <div className="mt-3 space-y-4 text-sm">
              <div className="space-y-1">
                <div>keywords: {result.keywords?.join(" / ")}</div>
                {result.similarKeywords && result.similarKeywords.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">類似キーワード:</span>
                    <div className="flex flex-wrap gap-1">
                      {result.similarKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-md bg-purple-100 px-2 py-0.5 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {result.amountRange && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">金額フィルタ:</span>
                    <span className="rounded-md bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      {result.amountRange.min != null && result.amountRange.max != null
                        ? `${result.amountRange.min.toLocaleString()}円 〜 ${result.amountRange.max.toLocaleString()}円`
                        : result.amountRange.min != null
                          ? `${result.amountRange.min.toLocaleString()}円以上`
                          : result.amountRange.max != null
                            ? `${result.amountRange.max.toLocaleString()}円以下`
                            : ""}
                    </span>
                  </div>
                )}
                {result.inferredCategory && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">推論カテゴリ:</span>
                    <span className="rounded-md bg-orange-100 px-2 py-0.5 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                      {result.inferredCategory}
                    </span>
                  </div>
                )}
                {result.searchMode && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">検索方式:</span>
                    <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                      {result.searchMode}
                    </span>
                    {result.reranked && (
                      <span className="rounded-md bg-pink-100 px-2 py-0.5 text-pink-800 dark:bg-pink-900 dark:text-pink-200">
                        リランク済
                      </span>
                    )}
                  </div>
                )}
                {result.searchStats && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">検索統計:</span>
                    {result.searchStats.vectorResults !== undefined && (
                      <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
                        ベクトル: {result.searchStats.vectorResults}件
                      </span>
                    )}
                    {result.searchStats.keywordResults !== undefined && (
                      <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
                        キーワード: {result.searchStats.keywordResults}件
                      </span>
                    )}
                    {result.searchStats.fulltextResults !== undefined && (
                      <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
                        全文: {result.searchStats.fulltextResults}件
                      </span>
                    )}
                    {result.searchStats.mergedResults !== undefined && (
                      <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
                        統合: {result.searchStats.mergedResults}件
                      </span>
                    )}
                    {result.searchStats.queriesExecuted !== undefined && (
                      <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {result.searchStats.queriesExecuted}クエリ実行
                      </span>
                    )}
                    {result.searchStats.threshold !== undefined && (
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                        閾値: {result.searchStats.threshold}
                      </span>
                    )}
                  </div>
                )}
                <div className="whitespace-pre-wrap">
                  queryText: {result.queryText}
                </div>
              </div>
              {result.matches && result.matches.length > 0 ? (
                <div className="space-y-3">
                  {result.matches.map((match) => (
                    <div className="rounded-md border bg-background/70 p-3" key={match.id}>
                      <div className="text-sm font-semibold">
                        score: {match.score.toFixed(4)}
                        {(result.searchStats || match.rrfBreakdown) && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (RRFスコア)
                          </span>
                        )}
                      </div>
                      {match.rrfBreakdown && match.rrfBreakdown.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="text-xs text-muted-foreground">内訳:</span>
                          {match.rrfBreakdown.map((b, i) => (
                            <span
                              key={`${b.source}-${i}`}
                              className={`rounded px-1.5 py-0.5 text-xs ${
                                b.source === "vector"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                  : b.source === "keyword"
                                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                    : b.source === "fulltext"
                                      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                      : b.source === "categoryBoost"
                                        ? b.contribution >= 0
                                          ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                        : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                              }`}
                              title={b.source === "categoryBoost"
                                ? `カテゴリ${b.contribution >= 0 ? "一致" : "不一致"}`
                                : `元スコア: ${b.originalScore.toFixed(4)}`}
                            >
                              {b.source === "categoryBoost"
                                ? `カテゴリ ${b.contribution >= 0 ? "+" : ""}${b.contribution.toFixed(4)}`
                                : `${b.source}[${b.rank + 1}位] +${b.contribution.toFixed(4)} (${b.originalScore.toFixed(4)})`}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        productId: {match.productId}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        cityCode: {match.cityCode ?? "-"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        金額: {match.amount ? `${match.amount.toLocaleString()}円` : "-"}
                      </div>
                      <div className="mt-2 text-sm">{match.text}</div>
                      {match.metadata && (
                        <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                          {JSON.stringify(match.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  類似結果がありません。
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.error ?? "不明なエラー"}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
