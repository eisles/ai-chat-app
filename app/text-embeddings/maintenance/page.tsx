import { MaintenanceDashboard } from "@/components/maintenance/dashboard";
import { getTextEmbeddingsMaintenanceState } from "@/lib/text-embeddings-maintenance";

import TextEmbeddingsMaintenanceActions from "./actions-client";

export const dynamic = "force-dynamic";

function formatRefreshedAt(value: string | null) {
  if (!value) {
    return "未更新";
  }
  return new Date(value).toLocaleString("ja-JP");
}

export default async function TextEmbeddingsMaintenancePage() {
  const state = await getTextEmbeddingsMaintenanceState();

  return (
    <MaintenanceDashboard
      title="商品テキスト index 管理"
      description={
        <>
          <code>product_text_embeddings</code> の統計確認と、必要時のメンテナンス操作を行います。
        </>
      }
      checkedAt={state.checkedAt}
      actions={<TextEmbeddingsMaintenanceActions />}
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
          label: "amount あり",
          value: state.summary.amountRows.toLocaleString("ja-JP"),
        },
        {
          label: "product_json 行",
          value: state.summary.productJsonRows.toLocaleString("ja-JP"),
          description: `embedded: ${state.summary.embeddedRows.toLocaleString("ja-JP")}`,
        },
        {
          label: "カテゴリ候補 cache",
          value: state.summary.categoryCandidatesCachedRows.toLocaleString("ja-JP"),
          description: `最終更新: ${formatRefreshedAt(state.summary.categoryCandidatesRefreshedAt)}`,
        },
      ]}
      tables={state.tables}
      indexes={state.indexes}
      activeRebuilds={state.activeRebuilds}
      recentLogs={state.recentLogs}
    />
  );
}
