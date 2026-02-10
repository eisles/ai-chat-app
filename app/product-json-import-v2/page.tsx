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
type CaptionImageInputMode = "url" | "data_url";

type Job = {
  id: string;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  existingBehavior: ExistingBehavior;
  doTextEmbedding: boolean;
  doImageCaptions: boolean;
  doImageVectors: boolean;
  captionImageInput: CaptionImageInputMode;
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
  queueStats?: {
    pendingReadyCount: number;
    pendingDelayedCount: number;
    processingCount: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    nextRetryAt: string | null;
  };
  error?: string;
};

type RunResponse = {
  ok: boolean;
  job?: Job | null;
  processed?: number;
  retried?: number;
  released?: number;
  timeBudgetMs?: number;
  itemReports?: Array<{
    itemId: string;
    rowIndex: number;
    productId: string | null;
    cityCode: string | null;
    outcome: "success" | "skipped" | "failed" | "retry" | "released";
    attemptCount: number;
    steps: Array<{ step: string; ms: number }>;
    error?: string | null;
    errorCode?: string | null;
    retryAfterSeconds?: number | null;
  }>;
  error?: string;
};

export default function ProductJsonImportV2Page() {
  const [file, setFile] = useState<File | null>(null);
  const [existingBehavior, setExistingBehavior] =
    useState<ExistingBehavior>("skip");
  const [doTextEmbedding, setDoTextEmbedding] = useState(true);
  const [doImageCaptions, setDoImageCaptions] = useState(true);
  const [doImageVectors, setDoImageVectors] = useState(true);
  const [captionImageInput, setCaptionImageInput] =
    useState<CaptionImageInputMode>("url");
  const [limit, setLimit] = useState("5");
  const [timeBudgetMs, setTimeBudgetMs] = useState("10000");
  const [captionConcurrency, setCaptionConcurrency] = useState("4");
  const [vectorizeConcurrency, setVectorizeConcurrency] = useState("2");
  const [debugTimings, setDebugTimings] = useState(true);
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);

  const [job, setJob] = useState<Job | null>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [queueStats, setQueueStats] = useState<JobResponse["queueStats"] | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTicking = useRef(false);
  const [consecutiveRunErrors, setConsecutiveRunErrors] = useState(0);
  const MAX_CONSECUTIVE_RUN_ERRORS = 3;

  async function fetchStatus(jobId: string) {
    const res = await fetch(`/api/product-json-import-v2?jobId=${jobId}`);
    const data = (await res.json()) as JobResponse;
    if (!data.ok) {
      throw new Error(data.error ?? "ステータス取得に失敗しました");
    }
    setJob(data.job ?? null);
    setFailedItems(data.failedItems ?? []);
    setProcessingItems(data.processingItems ?? []);
    setQueueStats(data.queueStats ?? null);
    return data;
  }

  async function runBatch() {
    if (!job) return null;
    const res = await fetch("/api/product-json-import-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: job.id,
        limit: parseInt(limit, 10) || 5,
        timeBudgetMs: parseInt(timeBudgetMs, 10) || 10000,
        debugTimings,
        captionConcurrency: parseInt(captionConcurrency, 10) || 4,
        vectorizeConcurrency: parseInt(vectorizeConcurrency, 10) || 2,
      }),
    });
    const data = (await res.json()) as RunResponse;
    if (!data.ok) {
      throw new Error(data.error ?? "バッチ処理に失敗しました");
    }
    setLastRun(data);
    if (data.job) {
      setJob(data.job);
      return data.job;
    }
    return null;
  }

  useEffect(() => {
    if (!job || !isRunning) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const calcDelayMs = (
      qs: JobResponse["queueStats"] | undefined
    ): number => {
      const fallback = 5000;
      if (!qs?.nextRetryAt) return fallback;
      const next = new Date(qs.nextRetryAt).getTime();
      if (Number.isNaN(next)) return fallback;
      const diff = next - Date.now();
      return Math.max(1000, Math.min(30_000, diff));
    };

    const tick = async () => {
      if (cancelled) return;
      if (isTicking.current) {
        timer = setTimeout(tick, 1000);
        return;
      }

      isTicking.current = true;
      try {
        const latestJob = await runBatch();
        const status = await fetchStatus(job.id);
        setConsecutiveRunErrors(0);
        if (latestJob?.status === "completed") {
          setIsRunning(false);
          return;
        }
        timer = setTimeout(tick, calcDelayMs(status.queueStats));
      } catch (runError) {
        const message =
          runError instanceof Error ? runError.message : "処理に失敗しました";
        setError(message);
        setConsecutiveRunErrors((prev) => {
          const next = prev + 1;
          if (next >= MAX_CONSECUTIVE_RUN_ERRORS) {
            setError(
              `連続エラーが${MAX_CONSECUTIVE_RUN_ERRORS}回続いたため自動停止しました: ${message}`
            );
            setIsRunning(false);
            return next;
          }
          // 失敗が断続的な場合は継続する（少し待ってから再試行）
          timer = setTimeout(tick, 10_000);
          return next;
        });
      } finally {
        isTicking.current = false;
      }
    };

    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [job, isRunning, limit, timeBudgetMs]);

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
      formData.append("doTextEmbedding", String(doTextEmbedding));
      formData.append("doImageCaptions", String(doImageCaptions));
      formData.append("doImageVectors", String(doImageVectors));
      formData.append("captionImageInput", captionImageInput);
      const res = await fetch("/api/product-json-import-v2", {
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
      setQueueStats(data.queueStats ?? null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "取り込みに失敗しました"
      );
    } finally {
      setIsUploading(false);
    }
  }

  const statusLabel = job ? `${job.processedCount}/${job.totalCount}` : "-";
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
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };
  const formatAvgPerItem = (jobValue: Job | null) => {
    if (!jobValue || jobValue.processedCount === 0) return "-";
    const startDate = new Date(jobValue.createdAt);
    const endDate = jobValue.completedAt ? new Date(jobValue.completedAt) : new Date();
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return "-";
    }
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const avgMs = Math.floor(diffMs / jobValue.processedCount);
    return `${(avgMs / 1000).toFixed(2)}s`;
  };
  const lastRunAvgSeconds = (() => {
    const reports = lastRun?.itemReports ?? [];
    if (reports.length === 0) return "-";
    const successful = reports.filter((r) => r.outcome === "success");
    if (successful.length === 0) return "-";
    const totals = successful.map((r) =>
      r.steps.reduce((sum, step) => sum + step.ms, 0)
    );
    const avgMs = Math.floor(totals.reduce((a, b) => a + b, 0) / totals.length);
    return `${(avgMs / 1000).toFixed(2)}s`;
  })();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Product JSON Import v2
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          商品JSON CSV取り込み (v2)
        </h1>
        <p className="text-sm text-muted-foreground">
          v2は大量件数向けのPOCです。CSVの列: city_code / product_id / product_json を想定しています。
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
                <SelectItem value="skip">何もしない（既存があればスキップ）</SelectItem>
                <SelectItem value="delete_then_insert">
                  削除して登録（既存を削除してから再登録）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 text-sm">
            <div className="font-medium">処理フラグ（デフォルトON）</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doTextEmbedding}
                onChange={(e) => setDoTextEmbedding(e.target.checked)}
              />
              <span>テキスト埋め込み</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doImageCaptions}
                onChange={(e) => setDoImageCaptions(e.target.checked)}
              />
              <span>画像キャプション</span>
            </label>
            <div className="flex flex-col gap-2 pl-6">
              <div className="text-xs text-muted-foreground">
                キャプション入力方式（OpenAIへ渡す方法）
              </div>
              <Select
                value={captionImageInput}
                onValueChange={(value) =>
                  setCaptionImageInput(value as CaptionImageInputMode)
                }
                disabled={!doImageCaptions}
              >
                <SelectTrigger className="w-full sm:w-[320px]">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="url">URLを渡す（高速）</SelectItem>
                  <SelectItem value="data_url">
                    画像を取得してdata URLで渡す（URLが外部から見えない場合）
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doImageVectors}
                onChange={(e) => setDoImageVectors(e.target.checked)}
              />
              <span>画像ベクトル</span>
            </label>
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
            <div>flags: text={String(job.doTextEmbedding)} captions={String(job.doImageCaptions)} vectors={String(job.doImageVectors)}</div>
            <div>captionImageInput: {job.captionImageInput}</div>
            <div>progress: {statusLabel}</div>
            <div>progress(%): {progressPercent}</div>
            <div>success: {job.successCount}</div>
            <div>failure: {job.failureCount}</div>
            <div>skipped: {job.skippedCount}</div>
            {queueStats && (
              <div>
                queue: pending_ready={queueStats.pendingReadyCount} pending_delayed={queueStats.pendingDelayedCount} processing={queueStats.processingCount} next_retry_at={formatJst(queueStats.nextRetryAt)}
              </div>
            )}
            <div>startedAt: {formatJst(job.createdAt)}</div>
            <div>completedAt: {formatJst(job.completedAt)}</div>
            <div>elapsed: {formatElapsed(job.createdAt, job.completedAt)}</div>
            <div>avg/item: {formatAvgPerItem(job)}</div>
            {lastRun?.itemReports && (
              <div>avg/item (last run, success only): {lastRunAvgSeconds}</div>
            )}
            {consecutiveRunErrors > 0 && (
              <div>連続エラー: {consecutiveRunErrors}</div>
            )}
          </div>

          {queueStats && queueStats.pendingReadyCount === 0 && queueStats.pendingDelayedCount > 0 && (
            <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              pending が next_retry_at により待機中です。次回: {formatJst(queueStats.nextRetryAt)}
            </div>
          )}

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
            <Button type="button" variant="secondary" onClick={() => fetchStatus(job.id)}>
              最新化
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const next = await runBatch();
                await fetchStatus(job.id);
                if (next?.status === "completed") setIsRunning(false);
              }}
              disabled={job.status === "completed"}
            >
              1回実行
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
            <div className="space-y-1">
              <label htmlFor="limit" className="text-xs text-muted-foreground">
                limit
              </label>
              <input
                id="limit"
                type="number"
                min="1"
                max="20"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="w-20 rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="timeBudgetMs" className="text-xs text-muted-foreground">
                timeBudgetMs
              </label>
              <input
                id="timeBudgetMs"
                type="number"
                min="1000"
                max="25000"
                value={timeBudgetMs}
                onChange={(e) => setTimeBudgetMs(e.target.value)}
                className="w-28 rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="captionConcurrency" className="text-xs text-muted-foreground">
                captions並列
              </label>
              <input
                id="captionConcurrency"
                type="number"
                min="1"
                max="8"
                value={captionConcurrency}
                onChange={(e) => setCaptionConcurrency(e.target.value)}
                className="w-20 rounded-md border bg-background px-3 py-2 text-sm"
                disabled={!job.doImageCaptions}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="vectorizeConcurrency" className="text-xs text-muted-foreground">
                vectorize並列
              </label>
              <input
                id="vectorizeConcurrency"
                type="number"
                min="1"
                max="4"
                value={vectorizeConcurrency}
                onChange={(e) => setVectorizeConcurrency(e.target.value)}
                className="w-20 rounded-md border bg-background px-3 py-2 text-sm"
                disabled={!job.doImageVectors}
              />
            </div>
            <label className="flex items-center gap-2 pb-1">
              <input
                type="checkbox"
                checked={debugTimings}
                onChange={(e) => setDebugTimings(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">
                詳細タイミングを表示（DB書き込みなし・レスポンスに含めます）
              </span>
            </label>
          </div>

          {lastRun?.itemReports && lastRun.itemReports.length > 0 && (
            <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">直近の実行ログ</div>
              <div className="mt-2 space-y-1 text-xs">
                {lastRun.itemReports.slice(-10).map((report, index) => (
                  <div key={`${report.itemId}-${report.outcome}-${index}`}>
                    row {report.rowIndex} / product_id {report.productId ?? "-"} / outcome{" "}
                    {report.outcome} / steps{" "}
                    {report.steps.map((s) => `${s.step}:${s.ms}ms`).join(", ")}
                    {report.error ? ` / error ${report.error}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}

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
    </div>
  );
}
