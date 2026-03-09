"use client";

import { Button } from "@/components/ui/button";
import type { VectorMaintenanceAction } from "@/lib/vectorize-product-images-maintenance";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ActionResponse =
  | {
      ok: true;
      action: VectorMaintenanceAction;
      message: string;
      executedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

const ACTION_LABELS: Record<VectorMaintenanceAction, string> = {
  analyze_tables: "ANALYZE 実行",
  rebuild_hnsw_index: "HNSW 再構築",
  repair_product_slide_unique_index: "unique 修復",
};

export default function ProductImagesVectorizeMaintenanceActions() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<VectorMaintenanceAction | null>(
    null
  );
  const [isRefreshing, startTransition] = useTransition();

  async function runAction(action: VectorMaintenanceAction) {
    setActiveAction(action);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/vectorize-product-images/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const data = (await res.json()) as ActionResponse;
      if (!res.ok || !data.ok) {
        setError(data.ok ? "メンテナンスに失敗しました。" : data.error);
        return;
      }

      setMessage(data.message);
      startTransition(() => {
        router.refresh();
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "メンテナンスに失敗しました。"
      );
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={activeAction !== null}
          onClick={() => runAction("analyze_tables")}
        >
          {activeAction === "analyze_tables"
            ? "ANALYZE 実行中..."
            : ACTION_LABELS.analyze_tables}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={activeAction !== null}
          onClick={() => runAction("rebuild_hnsw_index")}
        >
          {activeAction === "rebuild_hnsw_index"
            ? "HNSW 再構築中..."
            : ACTION_LABELS.rebuild_hnsw_index}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={activeAction !== null}
          onClick={() => runAction("repair_product_slide_unique_index")}
        >
          {activeAction === "repair_product_slide_unique_index"
            ? "unique 修復中..."
            : ACTION_LABELS.repair_product_slide_unique_index}
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        <code>ANALYZE</code> は統計更新、<code>HNSW 再構築</code> は近傍検索 index
        の再作成、<code>unique 修復</code> は重複除去後に{" "}
        <code>(product_id, slide_index)</code> index を再作成します。
      </div>

      {message ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {message}
          {isRefreshing ? " 画面を更新しています..." : ""}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
