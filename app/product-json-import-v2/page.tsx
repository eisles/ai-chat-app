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

type UploadItem = {
  rowIndex: number;
  cityCode: string | null;
  productId: string | null;
  productJson: string;
  status: "pending" | "failed";
  error?: string | null;
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

type JobsResponse = {
  ok: boolean;
  jobs?: Job[];
  error?: string;
};

type JobActionResponse = {
  ok: boolean;
  job?: Job | null;
  result?: {
    requeuedCount: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
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

type CreateJobResponse = {
  ok: boolean;
  jobId?: string;
  error?: string;
};

type AppendItemsResponse = {
  ok: boolean;
  inserted?: number;
  error?: string;
};

const UPLOAD_MAX_ROWS = 200;
const UPLOAD_MAX_BYTES = 1_000_000;
const UPLOAD_STATE_KEY = "product-json-import-v2-upload";

type CsvRow = Record<string, string>;

type UploadResumeState = {
  jobId: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  lastRowIndexSent: number;
  uploadedItems: number;
};

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/^\ufeff/, "");
}

function getColumn(record: CsvRow, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

const CITY_CODE_HEADERS = ["city_code", "city_cd", "citycode", "市区町村コード"];
const PRODUCT_ID_HEADERS = ["product_id", "productid", "id", "お礼の品id", "お礼の品ID"];
const PRODUCT_JSON_HEADERS = ["product_json", "json", "product", "jsonデータ", "ｊｓｏｎデータ"];

async function readJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  const text = await res.text();
  throw new Error(text || `HTTP ${res.status}`);
}

function estimateItemBytes(item: UploadItem) {
  return (
    (item.productJson?.length ?? 0) +
    (item.productId?.length ?? 0) +
    (item.cityCode?.length ?? 0) +
    200
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(1)}${units[index]}`;
}

export default function ProductJsonImportV2Page() {
  const [file, setFile] = useState<File | null>(null);
  const [existingBehavior, setExistingBehavior] =
    useState<ExistingBehavior>("skip");
  const [doTextEmbedding, setDoTextEmbedding] = useState(true);
  const [doImageCaptions, setDoImageCaptions] = useState(false);
  const [doImageVectors, setDoImageVectors] = useState(false);
  const [captionImageInput, setCaptionImageInput] =
    useState<CaptionImageInputMode>("url");
  const [limit, setLimit] = useState("5");
  const [timeBudgetMs, setTimeBudgetMs] = useState("10000");
  const [avgImageCount, setAvgImageCount] = useState("1");
  const [textConcurrency, setTextConcurrency] = useState("2");
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
  const [uploadProgress, setUploadProgress] = useState<{
    readBytes: number;
    totalBytes: number;
    uploadedItems: number;
  } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<
    Array<{ rowIndex: number; reason: string; preview: string }>
  >([]);
  const [resumeState, setResumeState] = useState<UploadResumeState | null>(null);
  const isTicking = useRef(false);
  const [consecutiveRunErrors, setConsecutiveRunErrors] = useState(0);
  const MAX_CONSECUTIVE_RUN_ERRORS = 3;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobActions, setJobActions] = useState<
    Record<string, { failed: boolean; skipped: boolean; success: boolean }>
  >({});
  const [jobFollowups, setJobFollowups] = useState<
    Record<
      string,
      {
        captions: boolean;
        vectors: boolean;
        captionImageInput: CaptionImageInputMode;
        includeFailed: boolean;
        includeSkipped: boolean;
        includeSuccess: boolean;
      }
    >
  >({});
  const [jobDeleteDownstream, setJobDeleteDownstream] = useState<
    Record<string, boolean>
  >({});
  const [deletingJobs, setDeletingJobs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(UPLOAD_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as UploadResumeState;
      if (
        typeof parsed?.jobId === "string" &&
        typeof parsed?.fileName === "string" &&
        typeof parsed?.fileSize === "number" &&
        typeof parsed?.fileLastModified === "number" &&
        typeof parsed?.lastRowIndexSent === "number" &&
        typeof parsed?.uploadedItems === "number"
      ) {
        setResumeState(parsed);
      }
    } catch {
      // ignore invalid saved state
    }
  }, []);

  const updateResumeState = (next: UploadResumeState | null) => {
    setResumeState(next);
    if (typeof window === "undefined") return;
    if (!next) {
      window.localStorage.removeItem(UPLOAD_STATE_KEY);
      return;
    }
    window.localStorage.setItem(UPLOAD_STATE_KEY, JSON.stringify(next));
  };

  async function fetchStatus(jobId: string) {
    const res = await fetch(`/api/product-json-import-v2?jobId=${jobId}`);
    const data = await readJsonResponse<JobResponse>(res);
    if (!data.ok) {
      throw new Error(data.error ?? "ステータス取得に失敗しました");
    }
    setJob(data.job ?? null);
    setFailedItems(data.failedItems ?? []);
    setProcessingItems(data.processingItems ?? []);
    setQueueStats(data.queueStats ?? null);
    return data;
  }

  async function fetchJobs() {
    const res = await fetch("/api/product-json-import-v2/jobs?limit=30");
    const data = await readJsonResponse<JobsResponse>(res);
    if (!data.ok) {
      throw new Error(data.error ?? "ジョブ一覧の取得に失敗しました");
    }
    const nextJobs = data.jobs ?? [];
    setJobs(nextJobs);
    setJobsError(null);
    setJobActions((prev) => {
      const next = { ...prev };
      for (const jobItem of nextJobs) {
        if (!next[jobItem.id]) {
          next[jobItem.id] = { failed: true, skipped: false, success: false };
        }
      }
      return next;
    });
    setJobDeleteDownstream((prev) => {
      const next = { ...prev };
      for (const jobItem of nextJobs) {
        if (next[jobItem.id] === undefined) {
          next[jobItem.id] = false;
        }
      }
      return next;
    });
    setJobFollowups((prev) => {
      const next = { ...prev };
      for (const jobItem of nextJobs) {
        if (!next[jobItem.id]) {
          next[jobItem.id] = {
            captions: true,
            vectors: true,
            captionImageInput: jobItem.captionImageInput ?? "url",
            includeFailed: false,
            includeSkipped: true,
            includeSuccess: true,
          };
        }
      }
      return next;
    });
    return nextJobs;
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
        textConcurrency: parseInt(textConcurrency, 10) || 2,
        captionConcurrency: parseInt(captionConcurrency, 10) || 4,
        vectorizeConcurrency: parseInt(vectorizeConcurrency, 10) || 2,
      }),
    });
    const data = await readJsonResponse<RunResponse>(res);
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
    fetchJobs().catch((fetchError) => {
      const message =
        fetchError instanceof Error ? fetchError.message : "ジョブ一覧の取得に失敗しました";
      setJobsError(message);
    });
  }, []);

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

  async function handleUpload(event: React.SyntheticEvent, mode: "new" | "resume") {
    event.preventDefault();
    if (!file) {
      setError("CSVファイルを選択してください");
      return;
    }
    setError(null);
    setUploadErrors([]);
    setIsUploading(true);

    try {
      const canResume =
        mode === "resume" &&
        resumeState &&
        resumeState.fileName === file.name &&
        resumeState.fileSize === file.size &&
        resumeState.fileLastModified === file.lastModified;
      if (mode === "resume" && !canResume) {
        throw new Error("再開情報が見つかりません。新規で作成してください。");
      }

      let jobId = "";
      let skipUntilRowIndex = 0;
      let uploadedItems = 0;

      if (canResume && resumeState) {
        jobId = resumeState.jobId;
        skipUntilRowIndex = resumeState.lastRowIndexSent;
        uploadedItems = resumeState.uploadedItems;
        try {
          await fetchStatus(jobId);
        } catch {
          updateResumeState(null);
          throw new Error("再開対象のジョブが見つかりません。新規で作成してください。");
        }
      } else {
        updateResumeState(null);
        const createRes = await fetch("/api/product-json-import-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_job",
            totalCount: 0,
            invalidCount: 0,
            existingBehavior,
            doTextEmbedding,
            doImageCaptions,
            doImageVectors,
            captionImageInput,
            forcePending: true,
          }),
        });
        const createData = await readJsonResponse<CreateJobResponse>(createRes);
        if (!createData.ok || !createData.jobId) {
          throw new Error(createData.error ?? "取り込みジョブ作成に失敗しました");
        }
        jobId = createData.jobId;
        updateResumeState({
          jobId,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          lastRowIndexSent: 0,
          uploadedItems: 0,
        });
      }

      const reader = file.stream().getReader();
      const decoder = new TextDecoder("utf-8");
      let headerRow: string[] | null = null;
      let headers: string[] = [];
      let cityCodeIndex = -1;
      let productIdIndex = -1;
      let productJsonIndex = -1;
      let currentRow: string[] = [];
      let cell = "";
      let inQuotes = false;
      let batch: UploadItem[] = [];
      let batchBytes = 0;
      let dataRowIndex = 0;
      let readBytes = 0;
      const totalBytes = file.size;
      setUploadProgress({ readBytes, totalBytes, uploadedItems });

      const flushBatch = async () => {
        if (batch.length === 0) return;
        const appendRes = await fetch("/api/product-json-import-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "append_items",
            jobId,
            items: batch,
          }),
        });
        const appendData = await readJsonResponse<AppendItemsResponse>(appendRes);
        if (!appendData.ok) {
          throw new Error(appendData.error ?? "取り込み明細の追加に失敗しました");
        }
        uploadedItems += batch.length;
        const lastRowIndexSent = batch[batch.length - 1]?.rowIndex ?? skipUntilRowIndex;
        updateResumeState({
          jobId,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          lastRowIndexSent,
          uploadedItems,
        });
        batch = [];
        batchBytes = 0;
        setUploadProgress({ readBytes, totalBytes, uploadedItems });
      };

      const finalizeRow = async () => {
        const row = [...currentRow, cell];
        currentRow = [];
        cell = "";
        if (!headerRow) {
          headerRow = row;
          headers = headerRow.map((value) => normalizeHeader(value));
          cityCodeIndex = headers.findIndex((header) =>
            CITY_CODE_HEADERS.includes(header)
          );
          productIdIndex = headers.findIndex((header) =>
            PRODUCT_ID_HEADERS.includes(header)
          );
          productJsonIndex = headers.findIndex((header) =>
            PRODUCT_JSON_HEADERS.includes(header)
          );
          return;
        }
        const rowIndex = dataRowIndex + 2;
        dataRowIndex += 1;
        if (rowIndex <= skipUntilRowIndex) {
          return;
        }
        const record: CsvRow = {};
        headers.forEach((header, index) => {
          record[header] = (row[index] ?? "").trim();
        });
        if (!Object.values(record).some((value) => value.length > 0)) {
          return;
        }
        const cityCode =
          cityCodeIndex >= 0
            ? (row[cityCodeIndex] ?? "").trim()
            : (row[0] ?? "").trim();
        const productId =
          productIdIndex >= 0
            ? (row[productIdIndex] ?? "").trim()
            : (row[1] ?? "").trim();
        let productJson =
          productJsonIndex >= 0 ? (row[productJsonIndex] ?? "").trim() : "";

        // Google Sheets等でクォートが崩れて列が分割された場合の救済
        if (!productJson) {
          const fallbackIndex =
            productJsonIndex >= 0
              ? productJsonIndex
              : row.findIndex((value) => {
                  const trimmed = value.trim();
                  return trimmed.startsWith("{") || trimmed.startsWith("\"{");
                });
          if (fallbackIndex >= 0 && row.length > fallbackIndex) {
            const tail = row.slice(fallbackIndex).join(",").trim();
            if (tail) {
              productJson = tail;
            }
          }
        }

        const item: UploadItem = productJson
          ? {
              rowIndex,
              cityCode: cityCode || null,
              productId: productId || null,
              productJson,
              status: "pending",
            }
          : {
              rowIndex,
              cityCode: cityCode || null,
              productId: productId || null,
              productJson: "",
              status: "failed",
              error: "product_json is required",
            };

        if (!productJson) {
          const preview = row
            .slice(0, Math.min(row.length, 6))
            .map((value) => value.replace(/\s+/g, " ").slice(0, 80))
            .join(" | ");
          setUploadErrors((prev) => {
            const next = [...prev, { rowIndex, reason: "product_json is required", preview }];
            return next.length > 5 ? next.slice(-5) : next;
          });
        }

        const itemBytes = estimateItemBytes(item);
        if (
          batch.length > 0 &&
          (batch.length >= UPLOAD_MAX_ROWS || batchBytes + itemBytes > UPLOAD_MAX_BYTES)
        ) {
          await flushBatch();
        }
        batch.push(item);
        batchBytes += itemBytes;
        if (batch.length >= UPLOAD_MAX_ROWS || batchBytes >= UPLOAD_MAX_BYTES) {
          await flushBatch();
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          readBytes += value.length;
          setUploadProgress({ readBytes, totalBytes, uploadedItems });
          const chunk = decoder.decode(value, { stream: !done });
          for (let i = 0; i < chunk.length; i += 1) {
            const char = chunk[i];
            const next = chunk[i + 1];

            if (inQuotes) {
              if (char === "\"") {
                if (next === "\"") {
                  cell += "\"";
                  i += 1;
                } else {
                  inQuotes = false;
                }
              } else {
                cell += char;
              }
              continue;
            }

            if (char === "\"") {
              inQuotes = true;
              continue;
            }
            if (char === ",") {
              currentRow.push(cell);
              cell = "";
              continue;
            }
            if (char === "\n") {
              await finalizeRow();
              continue;
            }
            if (char === "\r") {
              continue;
            }
            cell += char;
          }
        }
        if (done) break;
      }

      if (cell.length > 0 || currentRow.length > 0) {
        await finalizeRow();
      }

      if (!headerRow) {
        throw new Error("CSVヘッダーがありません");
      }

      await flushBatch();
      await fetchStatus(jobId);
      await fetchJobs();
      updateResumeState(null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "取り込みに失敗しました"
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleDeleteJob(target: Job) {
    const deleteDownstream = jobDeleteDownstream[target.id] ?? false;
    const confirm = window.confirm(
      `ジョブを削除しますか？\\njobId: ${target.id}\\n件数: ${target.totalCount}（success: ${target.successCount}, failed: ${target.failureCount}, skipped: ${target.skippedCount}）\\n※ items（CSVデータ）は削除されます。\\n※ downstream（埋め込み/画像ベクトル）削除: ${deleteDownstream ? "あり" : "なし"}`
    );
    if (!confirm) return;
    setDeletingJobs((prev) => ({ ...prev, [target.id]: true }));
    try {
      const res = await fetch(
        `/api/product-json-import-v2/jobs/${target.id}?deleteDownstream=${deleteDownstream ? "true" : "false"}`,
        {
          method: "DELETE",
        }
      );
      const data = await readJsonResponse<{ ok: boolean; error?: string }>(res);
      if (!data.ok) {
        throw new Error(data.error ?? "ジョブ削除に失敗しました");
      }
      if (resumeState?.jobId === target.id) {
        updateResumeState(null);
      }
      await fetchJobs();
    } finally {
      setDeletingJobs((prev) => ({ ...prev, [target.id]: false }));
    }
  }

  async function handleRequeueJob(target: Job) {
    const selection = jobActions[target.id] ?? {
      failed: true,
      skipped: false,
      success: false,
    };
    const statuses = [
      selection.failed ? "failed" : null,
      selection.skipped ? "skipped" : null,
      selection.success ? "success" : null,
    ].filter((value): value is "failed" | "skipped" | "success" => Boolean(value));
    if (statuses.length === 0) {
      throw new Error("再処理対象を選択してください");
    }
    const res = await fetch(`/api/product-json-import-v2/jobs/${target.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "requeue", statuses }),
    });
    const data = await readJsonResponse<{ ok: boolean; error?: string }>(res);
    if (!data.ok) {
      throw new Error(data.error ?? "再処理に失敗しました");
    }
    await fetchStatus(target.id);
    await fetchJobs();
  }

  async function handleAddProcessing(target: Job) {
    const followup = jobFollowups[target.id];
    if (!followup) {
      throw new Error("追加処理の設定がありません");
    }
    if (!followup.captions && !followup.vectors) {
      throw new Error("追加処理（キャプション/ベクトル）を選択してください");
    }
    const res = await fetch(`/api/product-json-import-v2/jobs/${target.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_processing",
        doTextEmbedding: false,
        doImageCaptions: followup.captions,
        doImageVectors: followup.vectors,
        captionImageInput: followup.captionImageInput,
        includeFailed: followup.includeFailed,
        includeSkipped: followup.includeSkipped,
        includeSuccess: followup.includeSuccess,
      }),
    });
    const data = await readJsonResponse<JobActionResponse>(res);
    if (!data.ok) {
      throw new Error(data.error ?? "追加処理に失敗しました");
    }
    if (data.job && job?.id === data.job.id) {
      setJob(data.job);
    }
    await fetchStatus(target.id);
    await fetchJobs();
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
  const estimateLabel = (() => {
    if (!job) return "-";
    const totalCount = Math.max(0, job.totalCount);
    if (totalCount === 0) return "-";
    const imageCount = (() => {
      const parsed = Number(avgImageCount);
      if (!Number.isFinite(parsed)) return 1;
      return Math.max(1, Math.min(20, Math.floor(parsed)));
    })();
    const minPerItem =
      (job.doTextEmbedding ? 1 : 0) +
      (job.doImageCaptions ? 2 * imageCount : 0) +
      (job.doImageVectors ? 1 * imageCount : 0);
    const maxPerItem =
      (job.doTextEmbedding ? 5 : 0) +
      (job.doImageCaptions ? 8 * imageCount : 0) +
      (job.doImageVectors ? 4 * imageCount : 0);
    const minTotal = totalCount * minPerItem;
    const maxTotal = totalCount * maxPerItem;
    const formatDuration = (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remain = seconds % 60;
      if (minutes < 60) return `${minutes}m ${remain}s`;
      const hours = Math.floor(minutes / 60);
      const remainMinutes = minutes % 60;
      return `${hours}h ${remainMinutes}m`;
    };
    return `${formatDuration(minTotal)}〜${formatDuration(maxTotal)}`;
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
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => handleUpload(event, "new")}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <div className="flex flex-col gap-2 text-sm">
            <div className="font-medium">既存データの扱い</div>
            <div className="text-xs text-muted-foreground">
              skipは既存のテキスト/キャプション/ベクトルが全て揃っている場合にスキップします。delete_then_insertは既存を削除して再登録します。
            </div>
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
            <div className="text-xs text-muted-foreground">
              必要な処理だけ有効にできます。画像系は処理時間が長くなります。
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doTextEmbedding}
                onChange={(e) => setDoTextEmbedding(e.target.checked)}
              />
              <span>テキスト埋め込み（目安: 1件あたり1〜5秒）</span>
            </label>
            <div className="text-xs text-muted-foreground pl-6">
              商品名/説明をEmbedding化して検索に使います。
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doImageCaptions}
                onChange={(e) => setDoImageCaptions(e.target.checked)}
              />
              <span>画像キャプション（目安: 1枚あたり2〜8秒）</span>
            </label>
            <div className="flex flex-col gap-2 pl-6">
              <div className="text-xs text-muted-foreground">
                キャプション入力方式（OpenAIへ渡す方法）
              </div>
              <div className="text-xs text-muted-foreground">
                URLは高速。data URLは画像が外部から見えない場合の代替です。
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
              <span>画像ベクトル（目安: 1枚あたり1〜4秒）</span>
            </label>
            <div className="text-xs text-muted-foreground pl-6">
              画像検索用のベクトルを作成します（重い処理）。
            </div>
            <div className="space-y-1 pl-6">
              <label htmlFor="avgImageCount" className="text-xs text-muted-foreground">
                平均画像枚数（見積り用）
              </label>
              <input
                id="avgImageCount"
                type="number"
                min="1"
                max="20"
                value={avgImageCount}
                onChange={(e) => setAvgImageCount(e.target.value)}
                className="w-24 rounded-md border bg-background px-3 py-2 text-sm"
                disabled={!doImageCaptions && !doImageVectors}
              />
              <div className="text-[11px] text-muted-foreground">
                キャプション/ベクトルの所要時間見積りに使用します。
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                Vercelで進まない場合の推奨手順
              </div>
              <div className="mt-1 space-y-1">
                <div>1. テキスト埋め込みだけONでジョブ作成</div>
                <div>2. 完了後、同じCSVで「画像キャプション」だけON</div>
                <div>3. 完了後、同じCSVで「画像ベクトル」だけON</div>
              </div>
              <div className="mt-2">各ステップは別ジョブになります。</div>
            </div>
          </div>

          <Button type="submit" disabled={isUploading}>
            {isUploading ? "アップロード中..." : "ジョブ作成"}
          </Button>
          {resumeState && (
            <div className="text-xs text-muted-foreground">
              再開情報: file={resumeState.fileName} / 送信済み {resumeState.uploadedItems}
              件 / 最終行 {resumeState.lastRowIndexSent}
            </div>
          )}
          {resumeState &&
            file &&
            (resumeState.fileName !== file.name ||
              resumeState.fileSize !== file.size ||
              resumeState.fileLastModified !== file.lastModified) && (
              <div className="text-xs text-muted-foreground">
                選択中のファイルと再開情報が一致しません。再開する場合は同じCSVを選択してください。
              </div>
            )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={
                isUploading ||
                !file ||
                !resumeState ||
                resumeState.fileName !== file.name ||
                resumeState.fileSize !== file.size ||
                resumeState.fileLastModified !== file.lastModified
              }
              onClick={(event) => handleUpload(event, "resume")}
            >
              アップロード再開
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isUploading}
              onClick={() => updateResumeState(null)}
            >
              再開情報を破棄
            </Button>
          </div>
          {isUploading && uploadProgress && (
            <div className="text-xs text-muted-foreground">
              読み込み: {formatBytes(uploadProgress.readBytes)} /{" "}
              {formatBytes(uploadProgress.totalBytes)}（
              {Math.min(
                100,
                Math.round(
                  (uploadProgress.readBytes / Math.max(1, uploadProgress.totalBytes)) *
                    100
                )
              )}
              %） / 送信済み: {uploadProgress.uploadedItems}件
            </div>
          )}
          {uploadErrors.length > 0 && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">直近の取込エラー（最大5件）</div>
              {uploadErrors.map((entry) => (
                <div key={`${entry.rowIndex}`}>
                  row {entry.rowIndex} / {entry.reason} / preview: {entry.preview}
                </div>
              ))}
            </div>
          )}
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
            <div>estimated(total): {estimateLabel}</div>
            <div className="text-xs text-muted-foreground">
              見積りは目安です。外部APIやネットワークにより大きく変動します。
            </div>
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
          <div className="mt-2 text-xs text-muted-foreground">
            <div>処理開始: 自動でrunを繰り返します（進捗が止まるまで継続）。</div>
            <div>停止: 自動実行を止めます（処理中の行は次回再開時に続行）。</div>
            <div>最新化: ステータス表示だけを更新します。</div>
            <div>1回実行: runを1回だけ実行します。</div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
            <div className="space-y-1">
              <label htmlFor="limit" className="text-xs text-muted-foreground">
                limit
              </label>
              <div className="text-[11px] text-muted-foreground">
                1回の実行で拾う件数（大きいほど一回の処理が重くなります）
              </div>
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
              <label htmlFor="textConcurrency" className="text-xs text-muted-foreground">
                text並列
              </label>
              <div className="text-[11px] text-muted-foreground">
                テキスト埋め込みの並列数。上げすぎると429が出ます。
              </div>
              <input
                id="textConcurrency"
                type="number"
                min="1"
                max="6"
                value={textConcurrency}
                onChange={(e) => setTextConcurrency(e.target.value)}
                className="w-20 rounded-md border bg-background px-3 py-2 text-sm"
                disabled={!job.doTextEmbedding}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="timeBudgetMs" className="text-xs text-muted-foreground">
                timeBudgetMs
              </label>
              <div className="text-[11px] text-muted-foreground">
                1回の実行で使う時間（ms）。Vercelは25,000程度推奨。
              </div>
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
              <div className="text-[11px] text-muted-foreground">
                画像キャプションの並列数。上げすぎると429が出ます。
              </div>
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
              <div className="text-[11px] text-muted-foreground">
                画像ベクトル化の並列数。上げすぎると失敗率が上がります。
              </div>
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

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">ジョブ一覧</h2>
          <Button type="button" variant="secondary" onClick={() => fetchJobs()}>
            更新
          </Button>
        </div>
        {jobsError && (
          <div className="mt-3 text-sm text-destructive">{jobsError}</div>
        )}
        {jobs.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">ジョブがありません。</div>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            {jobs.map((jobItem) => {
              const selection = jobActions[jobItem.id] ?? {
                failed: true,
                skipped: false,
                success: false,
              };
              const followup = jobFollowups[jobItem.id] ?? {
                captions: true,
                vectors: true,
                captionImageInput: "url" as CaptionImageInputMode,
                includeFailed: false,
                includeSkipped: true,
                includeSuccess: true,
              };
              const isDeleting = deletingJobs[jobItem.id] ?? false;
              return (
                <div
                  key={jobItem.id}
                  className="rounded-md border bg-muted/30 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">jobId: {jobItem.id}</div>
                    <div>status: {jobItem.status}</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    created: {formatJst(jobItem.createdAt)} / updated:{" "}
                    {formatJst(jobItem.updatedAt)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <div>
                      counts: {jobItem.processedCount}/{jobItem.totalCount}（success:
                      {jobItem.successCount} / failed:{jobItem.failureCount} / skipped:
                      {jobItem.skippedCount}）
                    </div>
                    <div>
                      flags: text={String(jobItem.doTextEmbedding)} captions=
                      {String(jobItem.doImageCaptions)} vectors=
                      {String(jobItem.doImageVectors)}
                    </div>
                    <div>existingBehavior: {jobItem.existingBehavior}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">再処理対象:</span>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selection.failed}
                          onChange={(event) =>
                            setJobActions((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...selection,
                                failed: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>failed</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selection.skipped}
                          onChange={(event) =>
                            setJobActions((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...selection,
                                skipped: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>skipped</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selection.success}
                          onChange={(event) =>
                            setJobActions((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...selection,
                                success: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>success</span>
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isDeleting}
                      onClick={async () => {
                        try {
                          await handleRequeueJob(jobItem);
                        } catch (actionError) {
                          setError(
                            actionError instanceof Error
                              ? actionError.message
                              : "再処理に失敗しました"
                          );
                        }
                      }}
                    >
                      再処理
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    再処理は既存のフラグのまま、選んだステータスを pending に戻します。
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">追加処理:</span>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={followup.captions}
                          onChange={(event) =>
                            setJobFollowups((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...followup,
                                captions: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>キャプション</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={followup.vectors}
                          onChange={(event) =>
                            setJobFollowups((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...followup,
                                vectors: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>画像ベクトル</span>
                      </label>
                      <Select
                        value={followup.captionImageInput}
                        onValueChange={(value) =>
                          setJobFollowups((prev) => ({
                            ...prev,
                            [jobItem.id]: {
                              ...followup,
                              captionImageInput: value as CaptionImageInputMode,
                            },
                          }))
                        }
                        disabled={!followup.captions}
                      >
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                          <SelectValue placeholder="caption入力" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="url">URL</SelectItem>
                          <SelectItem value="data_url">data URL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">対象:</span>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={followup.includeSuccess}
                          onChange={(event) =>
                            setJobFollowups((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...followup,
                                includeSuccess: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>success</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={followup.includeSkipped}
                          onChange={(event) =>
                            setJobFollowups((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...followup,
                                includeSkipped: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>skipped</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={followup.includeFailed}
                          onChange={(event) =>
                            setJobFollowups((prev) => ({
                              ...prev,
                              [jobItem.id]: {
                                ...followup,
                                includeFailed: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>failed</span>
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isDeleting}
                      onClick={async () => {
                        try {
                          await handleAddProcessing(jobItem);
                        } catch (actionError) {
                          setError(
                            actionError instanceof Error
                              ? actionError.message
                              : "追加処理に失敗しました"
                          );
                        }
                      }}
                    >
                      追加処理を開始
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      追加処理はテキスト埋め込みをOFFにして画像系のみ実行します。
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={jobDeleteDownstream[jobItem.id] ?? false}
                        disabled={isDeleting}
                        onChange={(event) =>
                          setJobDeleteDownstream((prev) => ({
                            ...prev,
                            [jobItem.id]: event.target.checked,
                          }))
                        }
                      />
                      <span>downstreamも削除</span>
                    </label>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isDeleting}
                      onClick={async () => {
                        try {
                          await handleDeleteJob(jobItem);
                        } catch (actionError) {
                          setError(
                            actionError instanceof Error
                              ? actionError.message
                              : "ジョブ削除に失敗しました"
                          );
                        }
                      }}
                    >
                      {isDeleting ? "削除中..." : "削除"}
                    </Button>
                    {isDeleting && (
                      <div className="text-xs text-muted-foreground">
                        削除処理を実行中です。完了までお待ちください。
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {error && (
        <Card className="border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}
    </div>
  );
}
