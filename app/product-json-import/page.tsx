"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";

type ExistingBehavior = "skip" | "delete_then_insert";

type Job = {
  id: string;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  existingBehavior: ExistingBehavior;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type FailedItem = {
  row_index: number;
  product_id: string | null;
  city_code: string | null;
  error: string | null;
};

type ProcessingItem = {
  row_index: number;
  product_id: string | null;
  city_code: string | null;
  updated_at: string;
};

type JobResponse = {
  ok: boolean;
  job?: Job | null;
  failedItems?: FailedItem[];
  processingItems?: ProcessingItem[];
  error?: string;
};

type BackfillStats = {
  totalProducts: number;
  productsWithImages: number;
  existingCaptions: number;
  pendingCaptions: number;
};

type BackfillResult = {
  productId: string;
  processed: number;
  skipped: number;
  errors: string[];
};

type BackfillResponse = {
  ok: boolean;
  stats?: BackfillStats;
  results?: BackfillResult[];
  summary?: {
    totalProcessed: number;
    totalSkipped: number;
    totalErrors: number;
  };
  error?: string;
};

export default function ProductJsonImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [existingBehavior, setExistingBehavior] =
    useState<ExistingBehavior>("skip");
  const [job, setJob] = useState<Job | null>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTicking = useRef(false);

  // バックフィル用のstate
  const [backfillStats, setBackfillStats] = useState<BackfillStats | null>(null);
  const [backfillLimit, setBackfillLimit] = useState("5");
  const [isBackfillRunning, setIsBackfillRunning] = useState(false);
  const [backfillResults, setBackfillResults] = useState<BackfillResult[]>([]);
  const [backfillSummary, setBackfillSummary] = useState<{
    totalProcessed: number;
    totalSkipped: number;
    totalErrors: number;
  } | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  // フィルタ用のstate
  const [filterCityCodeFrom, setFilterCityCodeFrom] = useState("");
  const [filterCityCodeTo, setFilterCityCodeTo] = useState("");
  const [filterProductIdFrom, setFilterProductIdFrom] = useState("");
  const [filterProductIdTo, setFilterProductIdTo] = useState("");

  async function fetchStatus(jobId: string) {
    const res = await fetch(`/api/product-json-import?jobId=${jobId}`);
    const data = (await res.json()) as JobResponse;
    if (!data.ok) {
      throw new Error(data.error ?? "ステータス取得に失敗しました");
    }
    setJob(data.job ?? null);
    setFailedItems(data.failedItems ?? []);
    setProcessingItems(data.processingItems ?? []);
  }

  async function fetchBackfillStats() {
    try {
      const res = await fetch("/api/product-json-import/backfill-captions");
      const data = (await res.json()) as BackfillResponse;
      if (!data.ok) {
        throw new Error(data.error ?? "統計取得に失敗しました");
      }
      setBackfillStats(data.stats ?? null);
      setBackfillError(null);
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : "統計取得に失敗しました");
    }
  }

  async function runBackfill() {
    setIsBackfillRunning(true);
    setBackfillError(null);
    setBackfillResults([]);
    setBackfillSummary(null);

    try {
      const res = await fetch("/api/product-json-import/backfill-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: parseInt(backfillLimit, 10) || 5,
          skipExisting: true,
          // フィルタ条件
          cityCodeFrom: filterCityCodeFrom || undefined,
          cityCodeTo: filterCityCodeTo || undefined,
          productIdFrom: filterProductIdFrom || undefined,
          productIdTo: filterProductIdTo || undefined,
        }),
      });
      const data = (await res.json()) as BackfillResponse;
      if (!data.ok) {
        throw new Error(data.error ?? "バックフィル処理に失敗しました");
      }
      setBackfillResults(data.results ?? []);
      setBackfillSummary(data.summary ?? null);
      // 統計を更新
      await fetchBackfillStats();
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : "バックフィル処理に失敗しました");
    } finally {
      setIsBackfillRunning(false);
    }
  }

  // 初回読み込み時にバックフィル統計を取得
  useEffect(() => {
    fetchBackfillStats();
  }, []);

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("CSVファイルを選択してください");
      return;
    }
    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("existingBehavior", existingBehavior);
      const res = await fetch("/api/product-json-import", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as JobResponse;
      if (!data.ok || !data.job) {
        throw new Error(data.error ?? "取り込みジョブ作成に失敗しました");
      }
      setJob(data.job);
      setFailedItems(data.failedItems ?? []);
      setProcessingItems(data.processingItems ?? []);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "取り込みに失敗しました"
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function runBatch() {
    if (!job) return;
    const res = await fetch("/api/product-json-import/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, limit: 2 }),
    });
    const data = (await res.json()) as JobResponse;
    if (!data.ok) {
      throw new Error(data.error ?? "バッチ処理に失敗しました");
    }
    if (data.job) {
      setJob(data.job);
      return data.job;
    }
    return null;
  }

  useEffect(() => {
    if (!job || !isRunning) return;

    const timer = setInterval(async () => {
      if (isTicking.current) return;
      isTicking.current = true;
      try {
        const latestJob = await runBatch();
        await fetchStatus(job.id);
        if (latestJob?.status === "completed") {
          setIsRunning(false);
        }
      } catch (runError) {
        setError(runError instanceof Error ? runError.message : "処理に失敗しました");
        setIsRunning(false);
      } finally {
        isTicking.current = false;
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [job, isRunning]);

  const statusLabel = job
    ? `${job.processedCount}/${job.totalCount}`
    : "-";
  const progressPercent = job?.totalCount
    ? Math.min(100, Math.round((job.processedCount / job.totalCount) * 100))
    : 0;
  const formatJst = (value: string | null) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  };
  const formatElapsed = (start: string | null, end: string | null) => {
    if (!start) return "-";
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return "-";
    }
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };
  const formatAvgPerItem = (jobValue: Job | null) => {
    if (!jobValue || jobValue.processedCount === 0) return "-";
    const startDate = new Date(jobValue.createdAt);
    const endDate = jobValue.completedAt
      ? new Date(jobValue.completedAt)
      : new Date();
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return "-";
    }
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const avgMs = Math.floor(diffMs / jobValue.processedCount);
    const totalSeconds = Math.floor(avgMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Product JSON Import
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          商品JSON CSV取り込み
        </h1>
        <p className="text-sm text-muted-foreground">
          CSVの列: city_code / product_id / product_json を想定しています。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">CSVアップロード</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleUpload}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex flex-col gap-2 text-sm">
            <div className="font-medium">既存データの扱い</div>
            <Select
              value={existingBehavior}
              onValueChange={(value) => setExistingBehavior(value as ExistingBehavior)}
            >
              <SelectTrigger className="w-full sm:w-[320px]">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">
                  何もしない（既存があればスキップ）
                </SelectItem>
                <SelectItem value="delete_then_insert">
                  削除して登録（既存を削除してから再登録）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={isUploading}>
            {isUploading ? "アップロード中..." : "ジョブ作成"}
          </Button>
        </form>
      </Card>

      {job && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">取り込み状況</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div>jobId: {job.id}</div>
            <div>status: {job.status}</div>
            <div>既存データの扱い: {job.existingBehavior}</div>
            <div>progress: {statusLabel}</div>
            <div>progress(%): {progressPercent}</div>
            <div>success: {job.successCount}</div>
            <div>failure: {job.failureCount}</div>
            <div>skipped: {job.skippedCount}</div>
            <div>startedAt: {formatJst(job.createdAt)}</div>
            <div>completedAt: {formatJst(job.completedAt)}</div>
            <div>elapsed: {formatElapsed(job.createdAt, job.completedAt)}</div>
            <div>avg/item: {formatAvgPerItem(job)}</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => setIsRunning(true)}
              disabled={isRunning || job.status === "completed"}
            >
              {isRunning ? "実行中..." : "処理開始"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsRunning(false)}
              disabled={!isRunning}
            >
              停止
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => fetchStatus(job.id)}
            >
              最新化
            </Button>
          </div>

          {failedItems.length > 0 && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <div className="font-medium">直近の失敗</div>
              <div className="mt-2 space-y-1 text-xs">
                {failedItems.map((item) => (
                  <div key={`${item.row_index}-${item.product_id ?? ""}`}>
                    row {item.row_index} / product_id {item.product_id ?? "-"} / city_code{" "}
                    {item.city_code ?? "-"} / {item.error ?? "Unknown error"}
                  </div>
                ))}
              </div>
            </div>
          )}

          {processingItems.length > 0 && (
            <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">処理中の行</div>
              <div className="mt-2 space-y-1 text-xs">
                {processingItems.map((item) => (
                  <div key={`${item.row_index}-${item.product_id ?? ""}`}>
                    row {item.row_index} / product_id {item.product_id ?? "-"} / city_code{" "}
                    {item.city_code ?? "-"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {error && (
        <Card className="border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      {/* 画像キャプションバックフィル */}
      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">画像キャプション バックフィル</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          既存データから画像を取得し、LLMでキャプションを生成してベクトルDBに登録します。
        </p>

        {/* 統計情報 */}
        {backfillStats && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border bg-muted/30 p-3 text-center">
              <div className="text-2xl font-bold">{backfillStats.totalProducts.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">総商品数</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-center">
              <div className="text-2xl font-bold">{backfillStats.productsWithImages.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">画像あり</div>
            </div>
            <div className="rounded-md border bg-green-50 dark:bg-green-950 p-3 text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                {backfillStats.existingCaptions.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">キャプション済</div>
            </div>
            <div className="rounded-md border bg-orange-50 dark:bg-orange-950 p-3 text-center">
              <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                {backfillStats.pendingCaptions.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">未処理（概算）</div>
            </div>
          </div>
        )}

        {/* 実行コントロール */}
        <div className="mt-4 space-y-3">
          {/* フィルタ条件 */}
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-sm font-medium mb-2">フィルタ条件（任意）</div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label htmlFor="filterCityCodeFrom" className="text-xs text-muted-foreground">
                  市区町村コード（From）
                </label>
                <input
                  id="filterCityCodeFrom"
                  type="text"
                  placeholder="例: 011002"
                  value={filterCityCodeFrom}
                  onChange={(e) => setFilterCityCodeFrom(e.target.value)}
                  className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="filterCityCodeTo" className="text-xs text-muted-foreground">
                  市区町村コード（To）
                </label>
                <input
                  id="filterCityCodeTo"
                  type="text"
                  placeholder="例: 019999"
                  value={filterCityCodeTo}
                  onChange={(e) => setFilterCityCodeTo(e.target.value)}
                  className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="filterProductIdFrom" className="text-xs text-muted-foreground">
                  商品ID（From）
                </label>
                <input
                  id="filterProductIdFrom"
                  type="text"
                  placeholder="例: 1000"
                  value={filterProductIdFrom}
                  onChange={(e) => setFilterProductIdFrom(e.target.value)}
                  className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="filterProductIdTo" className="text-xs text-muted-foreground">
                  商品ID（To）
                </label>
                <input
                  id="filterProductIdTo"
                  type="text"
                  placeholder="例: 2000"
                  value={filterProductIdTo}
                  onChange={(e) => setFilterProductIdTo(e.target.value)}
                  className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ※ 指定しない場合は全データが対象になります。コード・IDは文字列比較されます。
            </p>
          </div>

          {/* 実行ボタン */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="backfillLimit" className="text-sm font-medium">
                処理商品数
              </label>
              <input
                id="backfillLimit"
                type="number"
                min="1"
                max="50"
                value={backfillLimit}
                onChange={(e) => setBackfillLimit(e.target.value)}
                className="w-20 rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <Button
            type="button"
            onClick={runBackfill}
            disabled={isBackfillRunning}
          >
            {isBackfillRunning ? "処理中..." : "バックフィル実行"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={fetchBackfillStats}
          >
            統計更新
          </Button>
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          ※ 1商品あたり最大9画像（メイン + スライド8枚）を処理します。OpenAI API呼び出しが発生します。
        </p>

        {/* 実行結果 */}
        {backfillSummary && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3">
            <div className="font-medium">実行結果</div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-green-600 dark:text-green-400 font-bold">
                  {backfillSummary.totalProcessed}
                </span>
                <span className="ml-1 text-muted-foreground">件処理</span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400 font-bold">
                  {backfillSummary.totalSkipped}
                </span>
                <span className="ml-1 text-muted-foreground">件スキップ</span>
              </div>
              <div>
                <span className="text-red-600 dark:text-red-400 font-bold">
                  {backfillSummary.totalErrors}
                </span>
                <span className="ml-1 text-muted-foreground">件エラー</span>
              </div>
            </div>
          </div>
        )}

        {/* 詳細結果 */}
        {backfillResults.length > 0 && (
          <div className="mt-3 max-h-60 overflow-y-auto rounded-md border bg-background/50 p-2 text-xs">
            {backfillResults.map((result) => (
              <div
                key={result.productId}
                className="flex items-center gap-2 border-b py-1 last:border-b-0"
              >
                <span className="font-mono">{result.productId}</span>
                <span className="text-green-600 dark:text-green-400">
                  +{result.processed}
                </span>
                {result.skipped > 0 && (
                  <span className="text-gray-500">skip:{result.skipped}</span>
                )}
                {result.errors.length > 0 && (
                  <span className="text-red-500" title={result.errors.join(", ")}>
                    err:{result.errors.length}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* エラー表示 */}
        {backfillError && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {backfillError}
          </div>
        )}
      </Card>
    </div>
  );
}
