"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";

type ApiResult = {
  ok: boolean;
  id?: string;
  productId?: string;
  cityCode?: string;
  status?: string;
  stored?: number;
  skipped?: number;
  error?: string;
};

type BulkItem = {
  text: string;
  metadata: string;
  cityCode?: string;
  productId?: string;
};

const initialBulk: BulkItem[] = [
  { text: "北海道産りんごの詰め合わせ", metadata: "{\"source\":\"catalog\"}" },
  { text: "甘いとうもろこしセット", metadata: "{\"source\":\"catalog\"}" },
];

export default function TextRegistrationPage() {
  const [text, setText] = useState("");
  const [metadata, setMetadata] = useState("{}");
  const [productId, setProductId] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [bulkItems, setBulkItems] = useState(initialBulk);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  function parseMetadata(value: string) {
    if (!value.trim()) {
      return null;
    }
    return JSON.parse(value) as Record<string, unknown>;
  }

  async function handleSingleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const payload = {
        text,
        metadata: parseMetadata(metadata),
        productId: productId || undefined,
        cityCode: cityCode || undefined,
      };

      const res = await fetch("/api/texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as ApiResult;
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

  async function handleBulkSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const payload = {
        items: bulkItems.map((item) => ({
          text: item.text,
          metadata: parseMetadata(item.metadata),
          productId: item.productId || undefined,
          cityCode: item.cityCode || undefined,
        })),
      };

      const res = await fetch("/api/texts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as ApiResult;
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
          Text Registration
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">文字情報の登録</h1>
        <p className="text-sm text-muted-foreground">
          類似検索対象となるテキストを登録します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">単件登録</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSingleSubmit}>
          <div className="space-y-2">
            <div className="text-sm font-medium">text</div>
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="例: 北海道産りんごの詰め合わせ"
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">metadata (JSON)</div>
            <Input
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
              placeholder='{"source":"catalog"}'
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">cityCode (任意)</div>
            <Input
              value={cityCode}
              onChange={(event) => setCityCode(event.target.value)}
              placeholder="市町村コード"
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">productId (任意)</div>
            <Input
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              placeholder="任意の識別子"
            />
          </div>
          <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
            {isSubmitting ? "登録中..." : "登録する"}
          </Button>
        </form>
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">一括登録</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleBulkSubmit}>
          {bulkItems.map((item, index) => (
            <div className="grid gap-3 sm:grid-cols-4" key={index}>
              <Input
                value={item.text}
                onChange={(event) => {
                  const next = [...bulkItems];
                  next[index] = { ...next[index]!, text: event.target.value };
                  setBulkItems(next);
                }}
                placeholder="text"
              />
              <Input
                value={item.metadata}
                onChange={(event) => {
                  const next = [...bulkItems];
                  next[index] = { ...next[index]!, metadata: event.target.value };
                  setBulkItems(next);
                }}
                placeholder='{"source":"catalog"}'
              />
              <Input
                value={item.cityCode ?? ""}
                onChange={(event) => {
                  const next = [...bulkItems];
                  next[index] = { ...next[index]!, cityCode: event.target.value };
                  setBulkItems(next);
                }}
                placeholder="cityCode"
              />
              <Input
                value={item.productId ?? ""}
                onChange={(event) => {
                  const next = [...bulkItems];
                  next[index] = { ...next[index]!, productId: event.target.value };
                  setBulkItems(next);
                }}
                placeholder="productId"
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setBulkItems([
                  ...bulkItems,
                  { text: "", metadata: "{}", cityCode: "", productId: "" },
                ])
              }
            >
              行を追加
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "登録中..." : "一括登録"}
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">登録結果</h2>
          {result.ok ? (
            <pre className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
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
