import { getDb } from "@/lib/neon";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

async function fetchRows() {
  const db = getDb();
  const rows = await db<Row>`select * from playing_with_neon limit 100`;

  const columnSet = rows.reduce<Set<string>>((set, row) => {
    Object.keys(row ?? {}).forEach((key) => set.add(key));
    return set;
  }, new Set());

  return {
    rows,
    columns: Array.from(columnSet),
  };
}

function formatCell(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";
  return String(value);
}

export default async function PlayingWithNeonPage() {
  try {
    const { rows, columns } = await fetchRows();

    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Neon Table
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            playing_with_neon の一覧
          </h1>
          <p className="text-sm text-muted-foreground">
            最新100件を表示しています。接続情報は .env の NEON_DATABASE_URL から読み込みます。
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
            レコードがありません。
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border bg-card/60">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-4 py-3">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => (
                  <tr key={index} className="hover:bg-muted/40">
                    {columns.map((column) => (
                      <td key={column} className="whitespace-nowrap px-4 py-3">
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          playing_with_neon の一覧
        </h1>
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          データ取得に失敗しました: {message}
        </div>
      </div>
    );
  }
}
