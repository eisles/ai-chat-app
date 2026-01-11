"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";

type SearchMatch = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
};

type ApiResult = {
  ok: boolean;
  trackingId?: string;
  description?: string;
  elapsedMs?: number;
  matches?: SearchMatch[];
  error?: string;
};

export default function ImageSearchPage() {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [topK, setTopK] = useState("5");
  const [threshold, setThreshold] = useState("0.6");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

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
        }),
      );

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
            <img
              alt="preview"
              className="max-h-64 w-full rounded-md object-cover"
              src={previewUrl}
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
              </div>
              {result.matches && result.matches.length > 0 ? (
                <div className="space-y-3">
                  {result.matches.map((match) => (
                    <div
                      className="rounded-md border bg-background/70 p-3"
                      key={match.id}
                    >
                      <div className="text-sm font-semibold">
                        score: {match.score.toFixed(4)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        id: {match.id}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        productId: {match.productId}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        cityCode: {match.cityCode ?? "-"}
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
