"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";

type ResultRow = {
  id: string;
  city_code: string | null;
  product_id: string | null;
  image_url: string;
  distance: number;
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

export default function ProductImagesVectorizeSearchPage() {
  const [imageUrl, setImageUrl] = useState(
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg",
  );
  const [limit, setLimit] = useState("24");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

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
