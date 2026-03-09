import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getVectorMaintenanceState } from "@/lib/vectorize-product-images-maintenance";
import ProductImagesVectorizeMaintenanceActions from "./actions-client";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null) {
  if (!value) {
    return "未実行";
  }
  return new Date(value).toLocaleString("ja-JP");
}

export default async function ProductImagesVectorizeMaintenancePage() {
  const state = await getVectorMaintenanceState();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Maintenance
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          画像ベクトル index 管理
        </h1>
        <p className="text-sm text-muted-foreground">
          <code>product_images_vectorize</code> の統計確認と、必要時のメンテナンス操作を行います。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">操作</div>
            <div className="text-xs text-muted-foreground">
              画面表示時刻: {formatDateTime(state.checkedAt)}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <ProductImagesVectorizeMaintenanceActions />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border bg-card/60 p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">総行数</div>
          <div className="mt-2 text-2xl font-semibold">
            {state.summary.totalRows.toLocaleString("ja-JP")}
          </div>
        </Card>
        <Card className="border bg-card/60 p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">商品数</div>
          <div className="mt-2 text-2xl font-semibold">
            {state.summary.distinctProducts.toLocaleString("ja-JP")}
          </div>
        </Card>
        <Card className="border bg-card/60 p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">重複グループ</div>
          <div className="mt-2 text-2xl font-semibold">
            {state.summary.duplicateGroups.toLocaleString("ja-JP")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            余剰行: {state.summary.duplicateRows.toLocaleString("ja-JP")}
          </div>
        </Card>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">テーブル統計</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {state.tables.map((table) => (
            <div key={table.tableName} className="rounded-lg border bg-background/60 p-4">
              <div className="font-medium">{table.tableName}</div>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <div>live rows: {table.liveRows.toLocaleString("ja-JP")}</div>
                <div>dead rows: {table.deadRows.toLocaleString("ja-JP")}</div>
                <div>last analyze: {formatDateTime(table.lastAnalyze)}</div>
                <div>
                  last auto analyze: {formatDateTime(table.lastAutoAnalyze)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Index 状態</h2>
        <div className="mt-4 space-y-3">
          {state.indexes.map((index) => (
            <div
              key={index.indexName}
              className="rounded-lg border bg-background/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">{index.indexName}</div>
                <Badge variant={index.isValid ? "default" : "destructive"}>
                  {index.isValid ? "valid" : "invalid"}
                </Badge>
                <Badge variant={index.isReady ? "secondary" : "outline"}>
                  {index.isReady ? "ready" : "not-ready"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  size: {index.sizePretty ?? "unknown"}
                </span>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                {index.indexDef}
              </pre>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">進行中タスク</h2>
        {state.activeRebuilds.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">
            現在進行中の index 作成はありません。
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {state.activeRebuilds.map((job) => (
              <div
                key={job.processId}
                className="rounded-lg border bg-background/60 p-4 text-sm"
              >
                <div>pid: {job.processId}</div>
                <div>phase: {job.phase}</div>
                <div>
                  blocks: {job.blocksDone.toLocaleString("ja-JP")} /{" "}
                  {job.blocksTotal.toLocaleString("ja-JP")}
                </div>
                <div>
                  tuples done: {job.tuplesDone.toLocaleString("ja-JP")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
