"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";

type Job = {
  id: string;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
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

export default function ProductJsonImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTicking = useRef(false);

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
            <div>progress: {statusLabel}</div>
            <div>progress(%): {progressPercent}</div>
            <div>success: {job.successCount}</div>
            <div>failure: {job.failureCount}</div>
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
    </div>
  );
}
