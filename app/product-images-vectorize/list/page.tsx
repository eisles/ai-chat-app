import { getDb } from "@/lib/neon";
import ProductImagesVectorizeTable from "./table-client";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

type SerializableRow = Record<string, string | number | boolean | null>;

async function fetchRows() {
  const db = getDb();
  const rows =
    (await db`select * from public.product_images_vectorize limit 100`) as Row[];

  const serialized = rows.map<SerializableRow>((row) => {
    const entries = Object.entries(row).map<[string, SerializableRow[string]]>(
      ([key, value]) => {
        if (value instanceof Date) return [key, value.toISOString()];
        if (typeof value === "bigint") return [key, value.toString()];
        if (value === undefined) return [key, null];
        return [key, value as SerializableRow[string]];
      }
    );

    return Object.fromEntries(entries);
  });

  return serialized;
}

export default async function ProductImagesVectorizeListPage() {
  try {
    const rows = await fetchRows();

    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Neon Table
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            product_images_vectorize 一覧
          </h1>
          <p className="text-sm text-muted-foreground">
            最新100件を表示します。
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
            レコードがありません。
          </div>
        ) : (
          <ProductImagesVectorizeTable rows={rows} />
        )}
      </div>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          product_images_vectorize 一覧
        </h1>
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          データ取得に失敗しました: {message}
        </div>
      </div>
    );
  }
}
