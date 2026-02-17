"use client";

import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

function buildProductUrl(productId: string | null, cityCode: string | null): string {
  if (productId && cityCode) {
    return `https://www.furusato-tax.jp/product/detail/${cityCode}/${productId}`;
  }
  if (productId) {
    return `https://www.furusato-tax.jp/search?q=${productId}`;
  }
  return "https://www.furusato-tax.jp/";
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replaceAll(",", "").trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractProductInfo(metadata: Record<string, unknown> | null): {
  name: string | null;
  image: string | null;
  amount: number | null;
} {
  if (!metadata) {
    return { name: null, image: null, amount: null };
  }

  const raw = metadata.raw as Record<string, unknown> | undefined;
  if (!raw) {
    return { name: null, image: null, amount: null };
  }

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    image: typeof raw.image === "string" ? raw.image : null,
    amount: parseAmount(raw.amount),
  };
}

type SearchMatch = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
  amount?: number | null;
};

type ImageMatch = {
  id: string;
  productId: string | null;
  cityCode: string | null;
  slideIndex: number | null;
  imageUrl: string;
  distance: number;
  imageSimilarity: number;
  imageScore: number;
};

type CombinedMatch = {
  key: string;
  productId: string | null;
  cityCode: string | null;
  slideIndex: number | null;
  text?: string;
  metadata?: Record<string, unknown> | null;
  imageUrl?: string;
  amount?: number | null;
  textScore: number;
  textSimilarity: number;
  imageScore: number;
  imageSimilarity: number;
  imageDistance: number | null;
  textDistance: number | null;
  categoryAdjustment: number;
  score: number;
};

type AmountRange = {
  min?: number | null;
  max?: number | null;
};

type ApiResult = {
  ok: boolean;
  trackingId?: string;
  description?: string;
  inferredCategory?: string | null;
  amountRange?: AmountRange | null;
  amountFilterApplied?: boolean;
  elapsedMs?: number;
  matches?: SearchMatch[];
  imageMatches?: ImageMatch[];
  combinedMatches?: CombinedMatch[];
  weights?: { text: number; image: number };
  error?: string;
};

export default function ImageSearchPage() {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [topK, setTopK] = useState("5");
  const [threshold, setThreshold] = useState("0.6");
  const [useAmountFilter, setUseAmountFilter] = useState(true);
  const [selectedModel, setSelectedModel] = useState("openai:gpt-4o");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [displayMode, setDisplayMode] = useState<"debug" | "product">("product");

  const previewUrl = useMemo(() => {
    if (!file) {
      return null;
    }
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    if (!previewUrl) {
      return;
    }
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file && !imageUrl.trim()) {
      setResult({ ok: false, error: "画像ファイルかURLを入力してください" });
      return;
    }
    if (file && imageUrl.trim()) {
      setResult({ ok: false, error: "画像ファイルかURLのどちらかを指定してください" });
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      }
      if (imageUrl.trim()) {
        formData.append("imageUrl", imageUrl.trim());
      }
      formData.append(
        "options",
        JSON.stringify({
          top_k: topK ? Number(topK) : undefined,
          threshold: threshold ? Number(threshold) : undefined,
          use_amount_filter: useAmountFilter,
        }),
      );
      formData.append("model", selectedModel);

      const res = await fetch("/api/image-search", {
        method: "POST",
        body: formData,
      });

      let data: ApiResult;
      try {
        data = (await res.json()) as ApiResult;
      } catch {
        data = {
          ok: false,
          error: `Failed to parse response (status ${res.status})`,
        };
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
          Image To Text Search
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          画像アップロード検索
        </h1>
        <p className="text-sm text-muted-foreground">
          画像をアップロードして説明文を生成し、類似テキストを検索します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium">画像ファイル</div>
            <Input
              id="file"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
              }}
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">画像URL</div>
            <Input
              id="imageUrl"
              placeholder="https://example.com/image.jpg"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Vision モデル</div>
            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              filterVision
              className="w-full sm:w-64"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">top_k</div>
              <Input
                id="topK"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="5"
                value={topK}
                onChange={(event) => setTopK(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">threshold</div>
              <Input
                id="threshold"
                placeholder="0.6"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-md border p-3">
            <input
              type="checkbox"
              id="useAmountFilter"
              checked={useAmountFilter}
              onChange={(event) => setUseAmountFilter(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="useAmountFilter" className="text-sm font-medium">
              金額フィルタを適用する（画像説明文の「◯円」推定を検索条件に使う）
            </label>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-3">
            <div className="font-medium text-sm text-foreground">検索方式の仕様</div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded border bg-blue-50 p-2 dark:bg-blue-950">
                <div className="font-medium text-blue-800 dark:text-blue-200 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-blue-500"></span>
                  画像説明生成
                </div>
                <ul className="mt-1 space-y-0.5 text-blue-700 dark:text-blue-300">
                  <li>• Visionモデルで日本語キャプションを生成</li>
                  <li>• 入力はファイルか画像URLのどちらか</li>
                  <li>• 生成文からカテゴリと金額レンジも推定</li>
                </ul>
              </div>

              <div className="rounded border bg-green-50 p-2 dark:bg-green-950">
                <div className="font-medium text-green-800 dark:text-green-200 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-green-500"></span>
                  テキスト類似検索
                </div>
                <ul className="mt-1 space-y-0.5 text-green-700 dark:text-green-300">
                  <li>• OpenAI text-embedding-3-small</li>
                  <li>• product_text_embeddings を検索</li>
                  <li>• threshold と金額レンジで候補を絞り込み</li>
                </ul>
              </div>

              <div className="rounded border bg-orange-50 p-2 dark:bg-orange-950">
                <div className="font-medium text-orange-800 dark:text-orange-200 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-orange-500"></span>
                  画像ベクトル検索
                </div>
                <ul className="mt-1 space-y-0.5 text-orange-700 dark:text-orange-300">
                  <li>• Vectorize API (512次元)</li>
                  <li>• product_images_vectorize を距離順で検索</li>
                  <li>• 金額レンジ一致の top_k 件を統合に利用</li>
                </ul>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="font-medium text-sm text-foreground mb-2">
                統合スコア（最終ランキング）
              </div>
              <div className="space-y-1">
                <div>
                  • テキスト順位スコア: <code>1 / (rank + 1)</code>
                </div>
                <div>
                  • 画像順位スコア: <code>1 / (rank + 1)</code>
                </div>
                <div>
                  • 最終スコア: <code>0.6 × textScore + 0.4 × imageScore</code>
                </div>
                <div>
                  • カテゴリ一致: <code>+0.15</code> / 不一致: <code>-0.1</code>
                </div>
                <div>
                  • どちらか片方のみヒットした商品も候補に残します
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="font-medium text-sm text-foreground mb-1">
                パラメータの意味
              </div>
              <div className="space-y-1">
                <div>• <strong>top_k</strong>: テキスト検索と画像検索それぞれの取得件数</div>
                <div>• <strong>threshold</strong>: テキスト検索の類似度下限（0〜1）</div>
                <div>• <strong>金額フィルタ</strong>: ON時のみ、推定金額レンジで絞り込み</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              className="min-w-[160px]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "検索中..." : "画像検索"}
            </Button>
            <p className="text-sm text-muted-foreground">
              説明文生成後に類似検索します。
            </p>
          </div>
        </form>
      </Card>

      {previewUrl && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">アップロード画像</h2>
          <div className="mt-3 flex max-w-sm items-center justify-center rounded-md border bg-muted/50 p-3">
            <Image
              src={previewUrl}
              alt="preview"
              width={512}
              height={512}
              unoptimized
              className="max-h-64 w-full rounded-md object-cover"
            />
          </div>
        </Card>
      )}

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">検索結果</h2>
          {result.ok ? (
            <div className="mt-3 space-y-4 text-sm">
              <div className="space-y-1">
                <div>trackingId: {result.trackingId}</div>
                <div>elapsedMs: {result.elapsedMs} ms</div>
                <div className="whitespace-pre-wrap">
                  description: {result.description}
                </div>
                {result.inferredCategory && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">推論カテゴリ:</span>
                    <span className="rounded-md bg-orange-100 px-2 py-0.5 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                      {result.inferredCategory}
                    </span>
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
                    <span
                      className={`rounded-md px-2 py-0.5 ${
                        result.amountFilterApplied
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {result.amountFilterApplied ? "適用中" : "未適用"}
                    </span>
                  </div>
                )}
                {result.weights && (
                  <div>
                    weights: text {result.weights.text}, image {result.weights.image}
                  </div>
                )}
              </div>
              {result.combinedMatches && result.combinedMatches.length > 0 ? (
                <div className="space-y-3">
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
                    <div className="space-y-3">
                      {result.combinedMatches.map((match) => (
                        <div
                          className="rounded-md border bg-background/70 p-3"
                          key={match.key}
                        >
                          <div className="text-sm font-semibold">
                            score: {match.score.toFixed(4)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            productId: {match.productId ?? "-"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            cityCode: {match.cityCode ?? "-"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            slideIndex: {match.slideIndex ?? "-"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            textScore: {match.textScore.toFixed(4)} / imageScore: {match.imageScore.toFixed(4)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            textSimilarity: {match.textSimilarity.toFixed(4)} / imageSimilarity: {match.imageSimilarity.toFixed(4)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            textDistance: {match.textDistance !== null ? match.textDistance.toFixed(4) : "-"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            imageDistance: {match.imageDistance !== null ? match.imageDistance.toFixed(4) : "-"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            categoryAdjustment: {match.categoryAdjustment.toFixed(4)}
                          </div>
                          {match.imageUrl && (
                            <div className="mt-2 text-xs text-muted-foreground break-all">
                              imageUrl: {match.imageUrl}
                            </div>
                          )}
                          {match.text && (
                            <div className="mt-2 text-sm">{match.text}</div>
                          )}
                          {match.metadata && (
                            <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                              {JSON.stringify(match.metadata, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {result.combinedMatches.map((match) => {
                        const { name, image, amount } = extractProductInfo(
                          match.metadata ?? null,
                        );
                        const displayName = name ?? (match.productId
                          ? `商品ID: ${match.productId}`
                          : `ID: ${match.key}`);
                        const displayImage = image ?? match.imageUrl ?? null;
                        const displayAmount = match.amount ?? amount;
                        const productUrl = buildProductUrl(match.productId, match.cityCode);

                        return (
                          <div
                            key={match.key}
                            className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md"
                          >
                            <div className="relative aspect-[4/3] bg-muted">
                              {displayImage ? (
                                <Image
                                  src={displayImage}
                                  alt={displayName}
                                  fill
                                  className="object-cover"
                                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                  onError={(event) => {
                                    const target = event.currentTarget;
                                    target.style.display = "none";
                                    const fallback =
                                      target.parentElement?.querySelector(".image-fallback");
                                    if (fallback) {
                                      (fallback as HTMLElement).style.display = "flex";
                                    }
                                  }}
                                />
                              ) : null}
                              <div
                                className={`image-fallback absolute inset-0 items-center justify-center bg-muted text-4xl ${
                                  displayImage ? "hidden" : "flex"
                                }`}
                              >
                                📦
                              </div>
                            </div>

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
                                {displayAmount != null
                                  ? `${displayAmount.toLocaleString()}円`
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
