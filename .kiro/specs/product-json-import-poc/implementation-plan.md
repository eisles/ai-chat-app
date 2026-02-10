# 商品JSON CSV取り込み v2（Vercel Hobby / 15,000件想定）実装計画（POC）

## 目的
- Vercel（Hobby/Free）上で、`商品JSON CSV取り込み` を **15,000件規模**でも破綻しない形で完走させる。
- 既存の画面 `http://localhost:3000/product-json-import` は **一切修正しない**（v1として温存）。
- 新しい画面 `http://localhost:3000/product-json-import-v2`（v2）を追加し、v2専用APIで実行でき、途中で止まっても再開できる。
- 既存データの扱いは `skip` / `delete_then_insert` を維持する。
- 画像系（キャプション生成・画像ベクトル化）は「同時/後から」を選べる想定のため、ジョブにフラグを持たせる（デフォルトは全部ON）。
- ナビゲーションに v2 画面へのリンクを追加する。

## 前提と制約（この計画が解く問題）
- **画面で進捗を更新しても、サーバ側の1リクエスト実行時間上限は伸びない**。
  - よって、1回のAPI呼び出しで長時間処理する設計（全行INSERT、全件ベクトル化等）はタイムアウトしやすい。
- 現状の課題は主に2つ。
  1. `POST /api/product-json-import` が、CSV全件を配列化した上で `product_import_items` を **1行ずつINSERT**しており、件数が増えると遅い。
  2. `run` 側は小分け実行できるが、外部API（埋め込み/画像/キャプション）により 429/一時障害が起きる前提のため、リトライ設計が必要。

## スコープ
- POCとして、まずは「DBに `product_json` を保持する方式」を採用（方式1）。
- 15,000件を「実際に流し切る」ことをゴールにし、**完走性**（途中停止/再開、リトライ、進捗可視化）を優先する。

## 全体像（データフロー）
1. v2 UIでCSVをアップロード → `POST /api/product-json-import-v2` が取り込みジョブ（`product_import_jobs_v2`）と明細（`product_import_items_v2`）を作成
2. v2 UIで「処理開始」→ `POST /api/product-json-import-v2/run` を一定間隔で叩いて小分けに処理
3. 既存データの扱い（`skip` / `delete_then_insert`）に従い、必要なら削除して再登録、またはスキップ
4. 進捗・成功/失敗/スキップ数をUIで表示

---

## 実装ステップ

### Step 0. v2画面・v2 API・ナビリンクを追加する（分離の土台）
#### 目的
- v1を壊さずに、大量対応の変更をv2側へ隔離する。

#### 追加/変更ファイル（案）
- v2 UI: `app/product-json-import-v2/page.tsx`
- v2 API:
  - `app/api/product-json-import-v2/route.ts`（POST/GET）
  - `app/api/product-json-import-v2/run/route.ts`
- v2 lib: `lib/product-json-import-v2.ts`
- ナビリンク追加: `app/layout.tsx`

#### ナビリンク例（案）
```ts
// app/layout.tsx（案）
const navLinks = [
  // ...
  { href: "/product-json-import", label: "商品JSON取り込み(v1)" },
  { href: "/product-json-import-v2", label: "商品JSON取り込み(v2)" },
];
```

#### v2テーブル方針
- v2のジョブ管理は v2専用テーブルで分離（混線防止）
  - `public.product_import_jobs_v2`
  - `public.product_import_items_v2`
- 生成物（検索用ベクトルDB）は既存テーブルを **v1/v2で共有**（現状踏襲）
  - `product_text_embeddings`
  - `public.product_images_vectorize`

#### 共有（downstream）に関する前提
- v2で生成するベクトル/キャプション/画像ベクトルは、v1と同じ downstream テーブルに保存してよい。
- `existingBehavior=delete_then_insert` の場合、`product_id` 単位で downstream 側（`product_text_embeddings`, `public.product_images_vectorize`）を削除してから再登録する。
  - つまり、同一 `product_id` に対して他の機能が downstream に登録したデータがあっても削除される（POCの前提として許容する）。

---

### Step 1. `product_import_items` のINSERTを「バルク化」する（最優先）
#### 目的
- 15,000行を **15,000回のINSERT** ではなく、例えば **500〜2,000行単位のバルクINSERT** に置き換え、ジョブ作成のタイムアウト確率を下げる。

#### 変更点
- `lib/product-json-import-v2.ts` の `createImportJob()` を以下に分解する。
  - `insertImportItemsBatch(db, jobId, itemsBatch)`
  - `createImportJob()` は `jobs` を作成し、`items` はチャンクで `insertImportItemsBatch()` を呼ぶ

#### 例コード（案）
```ts
// lib/product-json-import-v2.ts（案）
async function insertImportItemsBatch(
  db: Awaited<ReturnType<typeof ensureProductImportTables>>,
  jobId: string,
  items: Array<{
    id: string;
    rowIndex: number;
    cityCode: string | null;
    productId: string | null;
    productJson: string;
    status: "pending" | "failed";
    error?: string | null;
  }>
): Promise<void> {
  if (items.length === 0) return;

  const ids = items.map((x) => x.id);
  const rowIndexes = items.map((x) => x.rowIndex);
  const cityCodes = items.map((x) => x.cityCode);
  const productIds = items.map((x) => x.productId);
  const productJsons = items.map((x) => x.productJson);
  const statuses = items.map((x) => x.status);
  const errors = items.map((x) => x.error ?? null);

  // UNNEST で1クエリ insert
  await db`
    insert into public.product_import_items (
      id, job_id, row_index, city_code, product_id, product_json, status, error
    )
    select
      x.id, ${jobId}, x.row_index, x.city_code, x.product_id, x.product_json, x.status, x.error
    from unnest(
      ${ids}::uuid[],
      ${rowIndexes}::int[],
      ${cityCodes}::text[],
      ${productIds}::text[],
      ${productJsons}::text[],
      ${statuses}::text[],
      ${errors}::text[]
    ) as x(
      id, row_index, city_code, product_id, product_json, status, error
    )
  `;
}
```

#### 受け入れ条件
- 15,000件のジョブ作成が「体感で極端に遅くならない」こと（1行ずつINSERTのような秒〜分単位の増加を抑える）

---

### Step 2. `run` に「時間予算」と「リトライ」を導入する
#### 目的
- 1回の `POST /api/product-json-import-v2/run` が長引いてタイムアウトするのを避ける。
- 外部APIの一時失敗（429/502等）で止まらずに進む。

#### 変更点
- `product_import_items_v2` に以下を追加
  - `attempt_count int not null default 0`
  - `next_retry_at timestamptz`
  - `error_code text`
- `claimPendingItems()` のSQLを「`pending` かつ `next_retry_at <= now()`」に拡張
- `run` に `timeBudgetMs` を渡せるようにし、時間が迫ったらループを打ち切って返す

#### 例コード（案）
```ts
// app/api/product-json-import-v2/run/route.ts（案）
const DEFAULT_TIME_BUDGET_MS = 10_000;

function parseTimeBudgetMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1000, Math.min(25_000, Math.floor(value)));
  }
  return DEFAULT_TIME_BUDGET_MS;
}

// for ループ内で
const deadline = Date.now() + timeBudgetMs;
for (const item of items) {
  if (Date.now() > deadline - 500) break; // 安全マージン
  // ...処理...
}
```

#### リトライ分類（案）
- 再試行しない: JSONパース失敗、必須項目不足（入力不正）
- 再試行する: 429、502、fetch timeout などの一時障害

---

### Step 3. 画像系の実行フラグをジョブに持たせる（デフォルト全部ON）
#### 目的
- デフォルトは「全部同時」でOKにしつつ、運用で切り替えできるようにする（高負荷時の逃げ道）。

#### 変更点
- `product_import_jobs_v2` に以下を追加
  - `do_text_embedding boolean not null default true`
  - `do_image_captions boolean not null default true`
  - `do_image_vectors boolean not null default true`
- v2 UI（`app/product-json-import-v2/page.tsx`）でチェックボックス（デフォルトON）
- `run` 側で `job.do_*` に応じて処理を分岐

#### 例コード（案）
```ts
// app/api/product-json-import-v2/run/route.ts（案）
if (job.do_text_embedding) {
  await registerTextEntry(...);
}
if (job.do_image_captions) {
  // 画像URL→キャプション→registerTextEntry
}
if (job.do_image_vectors) {
  await vectorizeProductImages(...);
}
```

---

### Step 4. v2 UIを「長時間運用」に耐える形に整える
#### 目的
- ブラウザで回し続けても暴走しない（多重実行、エラー時停止/再開、進捗の視認性）。

#### 変更点（案）
- v2画面で `処理開始` ボタン押下時に `setInterval` で `run` を叩く設計を採用しつつ、以下を追加
  - `limit`（1回の処理件数）をUIから調整（上限はサーバ側で固定）
  - `timeBudgetMs` もUIから指定可能（上限はサーバ側で固定）
  - 連続失敗が一定回数続いたら自動停止し、メッセージ表示
  - `skippedCount` を含む集計の表示

---

## 実行・検証手順（POC）
1. 15,000件CSVでジョブ作成できる（タイムアウトしない/遅すぎない）
2. UIで `run` を回して処理が進む（success/failed/skipped が増える）
3. 途中でページを閉じても、再度開いて `最新化`→`処理開始` で再開できる
4. 一時障害（429/502）が出ても、`next_retry_at` により進捗が止まらずに進む
5. `delete_then_insert` の場合、既存を削除して再登録できる（意図どおり）

---

## 既知の限界（このPOCのままでは厳しい点）
- 画像キャプション生成 + 画像ベクトル化は外部API呼び出し回数が多く、完了まで時間と費用が大きくなりやすい。
- `product_import_items.product_json` を保持する方式は、件数/JSONサイズが増えるとDB容量・I/Oが重くなる。
