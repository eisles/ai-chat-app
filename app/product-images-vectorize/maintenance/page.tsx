import { MaintenanceDashboard } from "@/components/maintenance/dashboard";
import { getVectorMaintenanceState } from "@/lib/vectorize-product-images-maintenance";

import ProductImagesVectorizeMaintenanceActions from "./actions-client";

export const dynamic = "force-dynamic";

export default async function ProductImagesVectorizeMaintenancePage() {
  const state = await getVectorMaintenanceState();

  return (
    <MaintenanceDashboard
      title="画像ベクトル index 管理"
      description={
        <>
          <code>product_images_vectorize</code> の統計確認と、必要時のメンテナンス操作を行います。
        </>
      }
      checkedAt={state.checkedAt}
      actions={<ProductImagesVectorizeMaintenanceActions />}
      summaryCards={[
        {
          label: "総行数",
          value: state.summary.totalRows.toLocaleString("ja-JP"),
        },
        {
          label: "商品数",
          value: state.summary.distinctProducts.toLocaleString("ja-JP"),
        },
        {
          label: "重複グループ",
          value: state.summary.duplicateGroups.toLocaleString("ja-JP"),
          description: `余剰行: ${state.summary.duplicateRows.toLocaleString("ja-JP")}`,
        },
      ]}
      tables={state.tables}
      indexes={state.indexes}
      activeRebuilds={state.activeRebuilds}
      recentLogs={state.recentLogs}
    />
  );
}
