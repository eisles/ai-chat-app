"use client";

import { MaintenanceActionsPanel } from "@/components/maintenance/actions-panel";

export default function ProductImagesVectorizeMaintenanceActions() {
  return (
    <MaintenanceActionsPanel
      endpoint="/api/vectorize-product-images/maintenance"
      source="/product-images-vectorize/maintenance"
      actions={[
        {
          value: "analyze_tables",
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
          value: "repair_product_slide_unique_index",
          label: "unique 修復",
          pendingLabel: "unique 修復中...",
          variant: "outline",
        },
      ]}
      helpText={
        <>
          <code>ANALYZE</code> は統計更新、<code>HNSW 再構築</code> は近傍検索
          index の再作成、<code>unique 修復</code> は重複除去後に{" "}
          <code>(product_id, slide_index)</code> index を再作成します。
        </>
      }
    />
  );
}
