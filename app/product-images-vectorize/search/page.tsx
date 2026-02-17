"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import { useState } from "react";

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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/vectorize-product-images/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: imageUrl || undefined,
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
                          <div className="aspect-square overflow-hidden rounded-md bg-muted/50">
                            <img
                              alt="result"
                              className="h-full w-full object-cover"
                              loading="lazy"
                              src={row.image_url}
                            />
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
