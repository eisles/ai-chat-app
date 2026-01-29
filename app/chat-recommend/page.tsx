"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";

type Match = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
  amount: number | null;
};

type ApiResult = {
  ok: boolean;
  keywords?: string[];
  queryText?: string;
  matches?: Match[];
  error?: string;
};

export default function ChatRecommendPage() {
  const [history, setHistory] = useState("");
  const [topK, setTopK] = useState("10");
  const [threshold, setThreshold] = useState("0.6");
  const [useReranking, setUseReranking] = useState(true);
  const [stopWordsInput, setStopWordsInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  useEffect(() => {
    fetch("/api/chat-recommend/stop-words")
      .then((res) => res.json())
      .then((data: { stopWords?: string[] }) => {
        setStopWordsInput((data.stopWords ?? []).join(", "));
      })
      .catch(() => {});
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
          stopWords: stopWordsInput
            .split(",")
            .map((w) => w.trim())
            .filter((w) => w),
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

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useReranking"
              checked={useReranking}
              onChange={(e) => setUseReranking(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="useReranking" className="text-sm font-medium">
              リランキングを使用
            </label>
          </div>

          {useReranking && (
            <div className="space-y-2">
              <div className="text-sm font-medium">除外キーワード（カンマ区切り）</div>
              <Input
                value={stopWordsInput}
                onChange={(e) => setStopWordsInput(e.target.value)}
                placeholder="例: ふるさと納税, 返礼品"
              />
            </div>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
            <div>
              <div className="font-medium mb-1">ベクトル検索:</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>検索クエリ: チャット履歴全体</li>
                <li>Embedding: text-embedding-3-small</li>
                <li>類似度: コサイン距離</li>
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">キーワード生成:</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>モデル: gpt-4o-mini</li>
                <li>temperature: 0.2</li>
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">リランキング:</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>1番目のキーワードがマッチ: +0.2</li>
                <li>1番目のキーワードがマッチしない: -0.1</li>
                <li>その他のキーワードがマッチ: 各+0.03</li>
              </ul>
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
                      </div>
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
