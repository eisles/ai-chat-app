"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";

type ApiResult = {
  ok: boolean;
  dryRun?: boolean;
  targetCount?: number;
  updatedCount?: number;
  error?: string;
};

export default function MigrateAmountPage() {
  const [productIdStart, setProductIdStart] = useState("");
  const [productIdEnd, setProductIdEnd] = useState("");
  const [cityCodeStart, setCityCodeStart] = useState("");
  const [cityCodeEnd, setCityCodeEnd] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/texts/migrate-amount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIdStart: productIdStart || undefined,
          productIdEnd: productIdEnd || undefined,
          cityCodeStart: cityCodeStart || undefined,
          cityCodeEnd: cityCodeEnd || undefined,
          dryRun,
        }),
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Migrate Amount
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          金額データのマイグレーション
        </h1>
        <p className="text-sm text-muted-foreground">
          metadataから金額を抽出してamountカラムに移行します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">PRODUCT_ID 開始</div>
              <Input
                value={productIdStart}
                onChange={(e) => setProductIdStart(e.target.value)}
                placeholder="例: 1000"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">PRODUCT_ID 終了</div>
              <Input
                value={productIdEnd}
                onChange={(e) => setProductIdEnd(e.target.value)}
                placeholder="例: 9999"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">CITY_CODE 開始</div>
              <Input
                value={cityCodeStart}
                onChange={(e) => setCityCodeStart(e.target.value)}
                placeholder="例: 010006"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">CITY_CODE 終了</div>
              <Input
                value={cityCodeEnd}
                onChange={(e) => setCityCodeEnd(e.target.value)}
                placeholder="例: 479993"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dryRun"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="dryRun" className="text-sm font-medium">
              ドライラン（対象件数のみ確認、更新しない）
            </label>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <div className="font-medium mb-1">処理内容:</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>text_source = product_json のレコードが対象</li>
              <li>metadata.raw.amountから金額を抽出</li>
              <li>amountカラムを更新（既存値も上書き）</li>
            </ul>
          </div>

          <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
            {isSubmitting ? "処理中..." : dryRun ? "対象件数を確認" : "マイグレーション実行"}
          </Button>
        </form>
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">結果</h2>
          {result.ok ? (
            <div className="mt-3 space-y-2 text-sm">
              <div>
                モード: {result.dryRun ? "ドライラン（確認のみ）" : "実行"}
              </div>
              <div>対象件数: {result.targetCount?.toLocaleString() ?? 0}</div>
              {!result.dryRun && (
                <div>更新件数: {result.updatedCount?.toLocaleString() ?? 0}</div>
              )}
              {result.dryRun && result.targetCount && result.targetCount > 0 && (
                <div className="mt-4 rounded-md bg-yellow-50 p-3 text-yellow-800">
                  ドライランをオフにして再実行すると、{result.targetCount.toLocaleString()}件が更新されます。
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
