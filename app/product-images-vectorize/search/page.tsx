"use client";

import { ProductImageGallery } from "@/components/product-image-gallery";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  collectProductImageEntries,
  extractProductInfo,
} from "@/lib/product-detail";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type ResultRow = {
  id: string;
  city_code: string | null;
  product_id: string | null;
  image_url: string;
  distance: number;
  metadata?: Record<string, unknown> | null;
  amount?: number | null;
};

type ApiResult = {
  ok: boolean;
  queryImageUrl?: string;
  embeddingDurationMs?: number;
  model?: string;
  dim?: number;
  normalized?: boolean | null;
  results?: ResultRow[];
  error?: string;
};

type SearchHistoryItem = {
  id: string;
  imageUrl: string;
  searchedAt: string;
  resultCount: number | null;
};

const SEARCH_HISTORY_KEY = "product_images_vectorize_search_history";
const SEARCH_HISTORY_LIMIT = 12;

function buildProductUrl(
  productId: string | null,
  cityCode: string | null,
  imageUrl: string,
): string {
  if (productId && cityCode) {
    return `https://www.furusato-tax.jp/product/detail/${cityCode}/${productId}`;
  }
  if (productId) {
    return `https://www.furusato-tax.jp/search?q=${productId}`;
  }
  return imageUrl;
}

function excludeSourceProductFromResults(
  rows: ResultRow[] | undefined,
  sourceProductId?: string | null,
): ResultRow[] {
  if (!rows || rows.length === 0) return [];
  const trimmedSourceProductId = sourceProductId?.trim();
  if (!trimmedSourceProductId) return rows;
  return rows.filter((row) => row.product_id !== trimmedSourceProductId);
}

export default function ProductImagesVectorizeSearchPage() {
  const [imageUrl, setImageUrl] = useState(
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg",
  );
  const [limit, setLimit] = useState("24");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [displayMode, setDisplayMode] = useState<"debug" | "product">(
    "product",
  );
  const [activeQueryImageUrl, setActiveQueryImageUrl] = useState<string | null>(
    null,
  );
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [modalItem, setModalItem] = useState<ResultRow | null>(null);

  const modalInfo = useMemo(
    () => (modalItem ? extractProductInfo(modalItem.metadata ?? null) : null),
    [modalItem],
  );
  const modalDisplayName = useMemo(() => {
    if (!modalItem) return null;
    if (modalInfo?.name) return modalInfo.name;
    if (modalItem.product_id) return `商品ID: ${modalItem.product_id}`;
    return `ID: ${modalItem.id}`;
  }, [modalInfo, modalItem]);
  const modalImages = useMemo(
    () =>
      modalItem
        ? collectProductImageEntries(modalItem.metadata ?? null, [
            { url: modalItem.image_url, sourceKey: "image_url" },
          ])
        : [],
    [modalItem]
  );
  const modalDescription = modalInfo?.description ?? "説明が登録されていません。";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SearchHistoryItem[];
      if (Array.isArray(parsed)) {
        setSearchHistory(parsed);
      }
    } catch {
      // noop
    }
  }, []);

  function createHistoryId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function updateSearchHistory(
    targetUrl: string,
    resultCount: number | null,
  ) {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;
    const nextItem: SearchHistoryItem = {
      id: createHistoryId(),
      imageUrl: trimmed,
      searchedAt: new Date().toISOString(),
      resultCount,
    };
    setSearchHistory((prev) => {
      const nextHistory = [
        nextItem,
        ...prev.filter((item) => item.imageUrl !== trimmed),
      ].slice(0, SEARCH_HISTORY_LIMIT);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          SEARCH_HISTORY_KEY,
          JSON.stringify(nextHistory),
        );
      }
      return nextHistory;
    });
  }

  function clearSearchHistory() {
    setSearchHistory([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SEARCH_HISTORY_KEY);
    }
  }

  async function runSearch(
    targetUrl: string,
    sourceProductId?: string | null,
  ) {
    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setResult({ ok: false, error: "画像URLが必要です。" });
      return;
    }
    setImageUrl(trimmed);
    setIsSubmitting(true);
    setResult(null);
    setActiveQueryImageUrl(trimmed);

    try {
      const res = await fetch("/api/vectorize-product-images/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: trimmed || undefined,
          limit: limit ? Number(limit) : undefined,
        }),
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
      const filteredResults = excludeSourceProductFromResults(
        data.results,
        sourceProductId,
      );
      const nextData: ApiResult = data.ok
        ? {
            ...data,
            results: filteredResults,
          }
        : data;
      setResult(nextData);
      if (data.ok) {
        updateSearchHistory(trimmed, filteredResults.length);
      }
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await runSearch(imageUrl);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Similarity Search
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          画像URLでベクトル検索
        </h1>
        <p className="text-sm text-muted-foreground">
          画像URLをベクトル化し、product_images_vectorize から類似順に検索します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
            <div className="text-sm font-medium">表示件数</div>
            <Input
              id="limit"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="24"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              className="min-w-[140px]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "検索中..." : "類似検索"}
            </Button>
            <p className="text-sm text-muted-foreground">
              ベクトル化して近い順に表示します。
            </p>
          </div>
        </form>
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">検索履歴</div>
            <div className="text-xs text-muted-foreground">
              最近の画像URL検索を再実行できます。
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clearSearchHistory}
            disabled={searchHistory.length === 0}
          >
            履歴をクリア
          </Button>
        </div>
        {searchHistory.length === 0 ? (
          <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            まだ検索履歴がありません。
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            {searchHistory.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-md border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-sm font-medium">
                    {item.imageUrl}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(item.searchedAt).toLocaleString("ja-JP")}
                    {item.resultCount != null
                      ? ` / 表示件数: ${item.resultCount}件`
                      : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void runSearch(item.imageUrl);
                  }}
                >
                  再検索
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">検索結果</h2>
          {result.ok ? (
            <div className="mt-3 space-y-4 text-sm">
              <div className="space-y-1">
                <div>status: ok</div>
                <div>model: {result.model}</div>
                <div>dim: {result.dim}</div>
                <div>normalized: {String(result.normalized)}</div>
                <div>vectorization time: {result.embeddingDurationMs} ms</div>
                <div className="break-all">
                  query imageUrl: {result.queryImageUrl}
                </div>
                <div>
                  表示件数: {result.results?.length ?? 0}件 / 設定件数:{" "}
                  {limit ? Number(limit) : 0}件
                </div>
              </div>

              {result.results && result.results.length > 0 ? (
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {result.results.map((row) => (
                        <div
                          className="rounded-lg border bg-background/70 p-3"
                          key={row.id}
                        >
                          <div className="relative aspect-square overflow-hidden rounded-md bg-muted/50">
                            {row.image_url ? (
                              <Image
                                src={row.image_url}
                                alt="result"
                                fill
                                className="object-cover"
                                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                画像なし
                              </div>
                            )}
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <div>distance: {row.distance.toFixed(6)}</div>
                            <div>city_code: {row.city_code ?? "-"}</div>
                            <div>product_id: {row.product_id ?? "-"}</div>
                            <div className="break-all">id: {row.id}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {result.results.map((row) => {
                        const { name, image } = extractProductInfo(
                          row.metadata ?? null,
                        );
                        const displayName = row.product_id
                          ? name ?? `商品ID: ${row.product_id}`
                          : name ?? `ID: ${row.id}`;
                        const productUrl = buildProductUrl(
                          row.product_id,
                          row.city_code,
                          row.image_url,
                        );
                        const displayImage = image ?? row.image_url;
                        const canSearch =
                          typeof row.image_url === "string" &&
                          row.image_url.trim().length > 0;
                        const isSearchingThisImage =
                          isSubmitting && activeQueryImageUrl === row.image_url;

                        return (
                          <div
                            key={row.id}
                            className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md"
                          >
                            {/* 商品画像 */}
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
                                      target.parentElement?.querySelector(
                                        ".image-fallback",
                                      );
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
                                {row.amount != null
                                  ? `${row.amount.toLocaleString()}円`
                                  : "金額未設定"}
                              </div>

                              <div className="mt-1 text-xs text-muted-foreground">
                                距離: {row.distance.toFixed(4)}
                              </div>

                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="mt-3 w-full"
                                onClick={() => setModalItem(row)}
                              >
                                画像と説明をみる
                              </Button>

                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2 w-full"
                                disabled={!canSearch || isSubmitting}
                                onClick={() => {
                                  if (!canSearch) return;
                                  void runSearch(row.image_url, row.product_id);
                                }}
                              >
                                {!canSearch
                                  ? "画像がないため検索不可"
                                  : isSearchingThisImage
                                    ? "類似画像を検索中..."
                                    : "この画像に似た商品を検索"}
                              </Button>
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

      <Dialog open={!!modalItem} onOpenChange={() => setModalItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{modalDisplayName ?? "商品詳細"}</DialogTitle>
            <DialogDescription>
              画像と説明文を確認できます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ProductImageGallery
              key={modalItem?.id ?? "empty"}
              images={modalImages}
              title={modalDisplayName ?? "商品画像"}
            />
            <div className="space-y-2 text-sm">
              <div className="text-muted-foreground">
                商品ID: {modalItem?.product_id ?? "-"} / 市町村コード:{" "}
                {modalItem?.city_code ?? "-"}
              </div>
              <div className="text-muted-foreground">
                金額:{" "}
                {modalItem?.amount != null
                  ? `${modalItem.amount.toLocaleString()}円`
                  : "金額未設定"}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {modalDescription}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
