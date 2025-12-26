"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

type ApiResult = {
  ok: boolean;
  productId?: number;
  imageUrl?: string;
  embeddingLength?: number;
  embeddingByteSize?: number;
  embeddingDurationMs?: number;
  model?: string;
  error?: string;
};

export default function ProductImagesOpenAIPage() {
  const [productId, setProductId] = useState("20250519");
  const [imageUrl, setImageUrl] = useState(
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/openai-product-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productId ? Number(productId) : undefined,
          imageUrl: imageUrl || undefined,
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Image → Vector (OpenAI)
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          OpenAIでベクトル化して保存 (1536次元, gpt-image-embedding-1)
        </h1>
        <p className="text-sm text-muted-foreground">
          OpenAI gpt-image-embedding-1 で 1536 次元にベクトル化し、
          Neon の product_images_openai に upsert します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium">product_id</div>
            <Input
              id="productId"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="product_id"
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">画像URL</div>
            <Textarea
              id="imageUrl"
              rows={3}
              placeholder="https://example.com/image.jpg"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              className="min-w-[140px]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "送信中..." : "ベクトル保存"}
            </Button>
            <p className="text-sm text-muted-foreground">
              1536次元でベクトル化し、product_images_openai に upsert します。
            </p>
          </div>
        </form>
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">API結果</h2>
          {result.ok ? (
            <div className="mt-3 space-y-1 text-sm">
              <div>status: ok</div>
              <div>productId: {result.productId}</div>
              <div>embedding length: {result.embeddingLength}</div>
              <div>embedding bytes (float32): {result.embeddingByteSize}</div>
              <div>vectorization time: {result.embeddingDurationMs} ms</div>
              <div>model: {result.model}</div>
              <div className="break-all">imageUrl: {result.imageUrl}</div>
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
