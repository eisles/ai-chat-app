"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

// 商品詳細URLを構築
function buildProductUrl(productId: string, cityCode: string | null): string {
  if (cityCode) {
    return `https://www.furusato-tax.jp/product/detail/${cityCode}/${productId}`;
  }
  return `https://www.furusato-tax.jp/search?q=${productId}`;
}

// metadata.rawから商品情報を取得
function extractProductInfo(metadata: Record<string, unknown> | null): {
  name: string | null;
  image: string | null;
} {
  if (!metadata) {
    return { name: null, image: null };
  }

  const raw = metadata.raw as Record<string, unknown> | undefined;
  if (!raw) {
    return { name: null, image: null };
  }

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    image: typeof raw.image === "string" ? raw.image : null,
  };
}

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

const budgetOptions = [
  "〜5,000円",
  "5,001〜10,000円",
  "10,001〜20,000円",
  "20,001〜30,000円",
  "30,001円以上",
];

const categoryOptions = [
  "肉",
  "魚介",
  "米・パン",
  "果物・野菜",
  "乳製品・卵",
  "お酒・飲料",
  "加工品・惣菜",
  "雑貨・日用品",
  "体験・宿泊",
];

const purposeOptions = [
  "自宅で食べる",
  "贈り物",
  "バーベキュー/キャンプ",
  "子ども向け",
  "ストック・備蓄",
];

const deliveryOptions = [
  "早く届く",
  "冷蔵",
  "冷凍",
  "常温",
  "日時指定できる",
];

const allergenOptions = ["なし", "乳", "卵", "小麦", "甲殻類", "牛肉"];

// 回答から検索クエリテキストを構築
function buildQueryFromAnswers(params: {
  budget: string;
  category: string;
  purpose: string;
  delivery: string[];
  allergen: string;
  prefecture: string;
  cityCode: string;
}): string {
  const parts: string[] = [];

  if (params.category) {
    parts.push(`${params.category}の返礼品を探しています。`);
  }

  if (params.budget) {
    parts.push(`予算は${params.budget}です。`);
  }

  if (params.purpose) {
    parts.push(`用途は${params.purpose}です。`);
  }

  if (params.delivery.length > 0) {
    parts.push(`配送条件: ${params.delivery.join("、")}を希望します。`);
  }

  if (params.allergen && params.allergen !== "なし") {
    parts.push(`${params.allergen}アレルギーがあります。`);
  }

  if (params.prefecture) {
    parts.push(`${params.prefecture}の返礼品を希望します。`);
  }

  if (params.cityCode) {
    parts.push(`市町村コード: ${params.cityCode}`);
  }

  return parts.join("\n");
}

export default function AgentRecommendPage() {
  // 質問回答
  const [budget, setBudget] = useState("");
  const [category, setCategory] = useState("");
  const [purpose, setPurpose] = useState("");
  const [delivery, setDelivery] = useState<string[]>([]);
  const [allergen, setAllergen] = useState("なし");
  const [prefecture, setPrefecture] = useState("");
  const [cityCode, setCityCode] = useState("");

  // 検索オプション
  const [topK, setTopK] = useState("10");
  const [threshold, setThreshold] = useState("0.35");
  const [useVectorSearch, setUseVectorSearch] = useState(true);
  const [useKeywordSearch, setUseKeywordSearch] = useState(true);
  const [useFullTextSearch, setUseFullTextSearch] = useState(false);
  const [useCategoryBoost, setUseCategoryBoost] = useState(true);
  const [useReranker, setUseReranker] = useState(false);
  const [cohereAvailable, setCohereAvailable] = useState<boolean | null>(null);

  // UI状態
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [displayMode, setDisplayMode] = useState<"debug" | "product">("debug");

  const answeredCount = useMemo(() => {
    let count = 0;
    if (budget) count += 1;
    if (category) count += 1;
    if (purpose) count += 1;
    if (delivery.length > 0) count += 1;
    if (allergen && allergen !== "なし") count += 1;
    if (prefecture || cityCode) count += 1;
    return count;
  }, [budget, category, purpose, delivery, allergen, prefecture, cityCode]);

  useEffect(() => {
    // Cohere APIの利用可否を取得
    fetch("/api/chat-recommend/status")
      .then((res) => res.json())
      .then((data: { cohereRerankerAvailable?: boolean }) => {
        setCohereAvailable(data.cohereRerankerAvailable ?? false);
      })
      .catch(() => setCohereAvailable(false));
  }, []);

  async function handleRecommend() {
    setIsSubmitting(true);
    setResult(null);

    try {
      const history = buildQueryFromAnswers({
        budget,
        category,
        purpose,
        delivery,
        allergen,
        prefecture,
        cityCode,
      });

      const res = await fetch("/api/chat-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history,
          topK: topK ? Number(topK) : undefined,
          threshold: threshold ? Number(threshold) : undefined,
          useReranking: true, // キーワード抽出は常に有効
          useSimilarSearch: false,
          useHybridSearch: true,
          useVectorSearch,
          useKeywordSearch,
          useFullTextSearch,
          useCategoryBoost,
          useReranker,
          model: "openai:gpt-4o-mini",
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

  function toggleDelivery(value: string) {
    setDelivery((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function handleReset() {
    setBudget("");
    setCategory("");
    setPurpose("");
    setDelivery([]);
    setAllergen("なし");
    setPrefecture("");
    setCityCode("");
    setResult(null);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Agent Guided Recommend
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          質問に答えて返礼品レコメンド
        </h1>
        <p className="text-sm text-muted-foreground">
          いくつかの質問に答えると、ハイブリッド検索でおすすめを提示します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>回答済み: {answeredCount}</span>
          <span> / 6</span>
        </div>
        <div className="mt-4 space-y-6">
          {/* Q1. 予算帯 */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Q1. 予算帯は？</div>
            <div className="flex flex-wrap gap-2">
              {budgetOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={budget === option ? "default" : "secondary"}
                  onClick={() => setBudget(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          {/* Q2. カテゴリ */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Q2. カテゴリは？</div>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={category === option ? "default" : "secondary"}
                  onClick={() => setCategory(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          {/* Q3. 用途 */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Q3. 用途は？</div>
            <div className="flex flex-wrap gap-2">
              {purposeOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={purpose === option ? "default" : "secondary"}
                  onClick={() => setPurpose(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          {/* Q4. 配送条件 */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Q4. 配送条件の希望は？</div>
            <div className="flex flex-wrap gap-2">
              {deliveryOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={delivery.includes(option) ? "default" : "secondary"}
                  onClick={() => toggleDelivery(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          {/* Q5. アレルゲン */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Q5. アレルゲン配慮は？</div>
            <div className="flex flex-wrap gap-2">
              {allergenOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={allergen === option ? "default" : "secondary"}
                  onClick={() => setAllergen(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          {/* Q6. 地域 */}
          <div className="space-y-3">
            <div className="text-sm font-medium">Q6. 地域の希望は？</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="都道府県 (任意)"
                value={prefecture}
                onChange={(event) => setPrefecture(event.target.value)}
              />
              <Input
                placeholder="市町村コード (任意)"
                value={cityCode}
                onChange={(event) => setCityCode(event.target.value)}
              />
            </div>
          </div>
        </div>

        {/* 検索オプション */}
        <div className="mt-6 space-y-4 border-t pt-4">
          <div className="text-sm font-medium">検索オプション</div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">top_k</div>
              <Input
                value={topK}
                onChange={(event) => setTopK(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">threshold</div>
              <Input
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">検索方式</div>
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
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={handleRecommend} disabled={isSubmitting}>
            {isSubmitting ? "レコメンド中..." : "レコメンドを見る"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleReset}>
            回答をリセット
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">レコメンド結果</h2>
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
                  {/* 表示切り替えトグル */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">表示モード:</span>
                    <div className="flex rounded-lg border p-1">
                      <button
                        type="button"
                        onClick={() => setDisplayMode("debug")}
                        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                          displayMode === "debug"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        デバッグ表示
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisplayMode("product")}
                        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                          displayMode === "product"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        商品カード表示
                      </button>
                    </div>
                  </div>

                  {displayMode === "debug" ? (
                    // デバッグ表示
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
                    // 商品カード表示
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {result.matches.map((match) => {
                        const { name, image } = extractProductInfo(match.metadata);
                        const productUrl = buildProductUrl(match.productId, match.cityCode);
                        const displayName = name || `商品ID: ${match.productId}`;

                        return (
                          <div
                            key={match.id}
                            className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md"
                          >
                            {/* 商品画像 */}
                            <div className="relative aspect-[4/3] bg-muted">
                              {image ? (
                                <Image
                                  src={image}
                                  alt={displayName}
                                  fill
                                  className="object-cover"
                                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                  onError={(e) => {
                                    const target = e.currentTarget;
                                    target.style.display = "none";
                                    const fallback = target.parentElement?.querySelector(".image-fallback");
                                    if (fallback) {
                                      (fallback as HTMLElement).style.display = "flex";
                                    }
                                  }}
                                />
                              ) : null}
                              <div
                                className={`image-fallback absolute inset-0 items-center justify-center bg-muted text-4xl ${
                                  image ? "hidden" : "flex"
                                }`}
                              >
                                📦
                              </div>
                            </div>

                            {/* 商品情報 */}
                            <div className="p-3">
                              <a
                                href={productUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline"
                                title={displayName}
                              >
                                {displayName}
                                <span className="ml-1 inline-block text-xs text-muted-foreground">
                                  ↗
                                </span>
                              </a>

                              <div className="mt-2 text-lg font-bold text-primary">
                                {match.amount
                                  ? `${match.amount.toLocaleString()}円`
                                  : "金額未設定"}
                              </div>

                              <div className="mt-1 text-xs text-muted-foreground">
                                スコア: {match.score.toFixed(4)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
