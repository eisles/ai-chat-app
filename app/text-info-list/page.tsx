import { getDb } from "@/lib/neon";
import TextInfoTable from "./table-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

type SerializableRow = Record<string, string | number | boolean | null>;

type SearchParams = {
  city_code?: string;
  product_id?: string;
  page?: string;
};

const PAGE_SIZE = 50;

async function fetchRows(options: {
  cityCode?: string;
  productId?: string;
  page: number;
}) {
  const db = getDb();
  const offset = (options.page - 1) * PAGE_SIZE;
  const cityCode = options.cityCode?.trim() || null;
  const productId = options.productId?.trim() || null;

  const totalRows = (await db`
    select count(*)::int as count
    from public.product_text_embeddings
    where (${cityCode}::text is null or city_code = ${cityCode})
      and (${productId}::text is null or product_id = ${productId})
  `) as Array<{ count: number }>;
  const totalCount = totalRows[0]?.count ?? 0;

  const rows =
    (await db`
      select *
      from public.product_text_embeddings
      where (${cityCode}::text is null or city_code = ${cityCode})
        and (${productId}::text is null or product_id = ${productId})
      order by created_at desc
      limit ${PAGE_SIZE}
      offset ${offset}
    `) as Row[];

  const serialized = rows.map<SerializableRow>((row) => {
    const entries = Object.entries(row).map<[string, SerializableRow[string]]>(
      ([key, value]) => {
        if (value instanceof Date) return [key, value.toISOString()];
        if (typeof value === "bigint") return [key, value.toString()];
        if (value === undefined) return [key, null];
        // Skip embedding vector field for display
        if (key === "embedding") return [key, "[vector]"];
        return [key, value as SerializableRow[string]];
      }
    );

    return Object.fromEntries(entries);
  });

  return { rows: serialized, totalCount };
}

function buildQuery(options: { cityCode?: string; productId?: string; page: number }) {
  const params = new URLSearchParams();
  if (options.cityCode) params.set("city_code", options.cityCode);
  if (options.productId) params.set("product_id", options.productId);
  params.set("page", String(options.page));
  return `?${params.toString()}`;
}

export default async function TextInfoListPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  try {
    const resolvedParams = await searchParams;
    const readParam = (value?: string | string[]) =>
      Array.isArray(value) ? value[0] ?? "" : value ?? "";
    const cityCode = readParam(resolvedParams?.city_code);
    const productId = readParam(resolvedParams?.product_id);
    const pageParam = readParam(resolvedParams?.page);
    const page = Math.max(1, Number(pageParam || "1") || 1);
    const { rows, totalCount } = await fetchRows({ cityCode, productId, page });
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const hasPrev = page > 1;
    const hasNext = page < totalPages;

    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Text Information
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            文字情報一覧
          </h1>
          <p className="text-sm text-muted-foreground">
            検索・ページャ付きで表示します。
          </p>
        </div>

        <form className="grid gap-3 rounded-lg border bg-card/60 p-4 sm:grid-cols-3">
          <div className="space-y-2">
            <div className="text-sm font-medium">city_code</div>
            <Input name="city_code" defaultValue={cityCode} placeholder="例: 01100" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">product_id</div>
            <Input name="product_id" defaultValue={productId} placeholder="例: 4970902" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit">検索</Button>
            <Button type="button" variant="secondary" asChild>
              <Link href="/text-info-list">クリア</Link>
            </Button>
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
            レコードがありません。
          </div>
        ) : (
          <TextInfoTable rows={rows} />
        )}

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>
            {totalCount} 件中 {Math.min(totalCount, (page - 1) * PAGE_SIZE + 1)}-
            {Math.min(totalCount, page * PAGE_SIZE)} 件
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={!hasPrev} asChild={hasPrev}>
              {hasPrev ? (
                <Link href={buildQuery({ cityCode, productId, page: page - 1 })}>
                  前へ
                </Link>
              ) : (
                <span>前へ</span>
              )}
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button type="button" variant="secondary" disabled={!hasNext} asChild={hasNext}>
              {hasNext ? (
                <Link href={buildQuery({ cityCode, productId, page: page + 1 })}>
                  次へ
                </Link>
              ) : (
                <span>次へ</span>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          文字情報一覧
        </h1>
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          データ取得に失敗しました: {message}
        </div>
      </div>
    );
  }
}
