"use client";

import { MaintenanceActionsPanel } from "@/components/maintenance/actions-panel";

export default function TextEmbeddingsMaintenanceActions() {
  return (
    <MaintenanceActionsPanel
      endpoint="/api/text-embeddings/maintenance"
      source="/text-embeddings/maintenance"
      actions={[
        {
          value: "analyze_table",
          label: "ANALYZE 実行",
          pendingLabel: "ANALYZE 実行中...",
          variant: "secondary",
        },
        {
          value: "rebuild_hnsw_index",
          label: "HNSW 再構築",
          pendingLabel: "HNSW 再構築中...",
          variant: "outline",
        },
        {
          value: "repair_amount_index",
          label: "amount index 修復",
          pendingLabel: "amount index 修復中...",
          variant: "outline",
        },
        {
          value: "refresh_category_candidates_cache",
          label: "カテゴリ候補 cache 更新",
          pendingLabel: "カテゴリ候補 cache 更新中...",
          variant: "outline",
        },
      ]}
      helpText={
        <>
          <code>ANALYZE</code> は統計更新、<code>HNSW 再構築</code> は近傍検索
          index の再作成、<code>amount index 修復</code> は
          <code>product_text_embeddings_amount_idx</code> を再作成します。
          <code>カテゴリ候補 cache 更新</code> は
          <code>recommend_category_candidates_cache</code> を再集計します。
        </>
      }
    />
  );
}
