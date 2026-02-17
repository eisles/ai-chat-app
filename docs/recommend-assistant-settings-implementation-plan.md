# Recommend Assistant 設定画面＋質問自動生成 実装計画

作成日: 2026-02-17  
対象: `ai-chat-app`

## 1. 目的

- 既存データ（`product_text_embeddings.metadata.raw`）を元に、質問案・選択肢案を自動生成する。
- `/recommend-assistant-settings` で人間が質問文・選択肢を編集できるようにする。
- 編集した設定を「公開」し、`/recommend-assistant` の会話で即時利用できるようにする。

## 2. ゴール / 非ゴール

### ゴール

- 設定画面で以下ができる。
  - メタデータから質問案・選択肢案を生成
  - 質問文・選択肢を手動編集
  - バージョン保存（draft）
  - 公開（published）切替
- 会話APIが公開済み設定を参照して質問を返す。
- 設定未公開/破損時はデフォルト設定でフォールバックする。

### 非ゴール（MVP外）

- 複数管理者の権限制御
- 高度なワークフロー（レビュー承認フロー）
- A/B テスト配信

## 3. 変更ファイル（予定）

| 種別 | パス | 目的 |
|---|---|---|
| 追加 | `migrations/20260217_recommend_assistant_question_sets.sql` | 設定保存テーブル |
| 追加 | `lib/recommend-assistant-config/types.ts` | 設定スキーマ型 |
| 追加 | `lib/recommend-assistant-config/default-config.ts` | フォールバック設定 |
| 追加 | `lib/recommend-assistant-config/repository.ts` | 設定CRUD・公開処理 |
| 追加 | `lib/recommend-assistant-config/candidate-generator.ts` | メタデータ起点の案生成 |
| 追加 | `app/api/recommend-assistant-settings/generate/route.ts` | 案生成API |
| 追加 | `app/api/recommend-assistant-settings/sets/route.ts` | 設定一覧/保存API |
| 追加 | `app/api/recommend-assistant-settings/publish/route.ts` | 公開切替API |
| 追加 | `app/recommend-assistant-settings/page.tsx` | 設定画面 |
| 変更 | `app/api/recommend/conversation/route.ts` | 公開設定の参照 |
| 変更 | `lib/recommend-conversation/session.ts` | ステップ外部注入対応 |
| 追加 | `tests/api/recommend-assistant-settings.test.ts` | 設定APIテスト |
| 変更 | `tests/api/recommend-conversation.test.ts` | 設定参照の回帰テスト |

## 4. データモデル

### 4.1 マイグレーション

```sql
-- migrations/20260217_recommend_assistant_question_sets.sql
create extension if not exists pgcrypto;

create table if not exists recommend_assistant_question_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null unique,
  status text not null check (status in ('draft', 'published', 'archived')),
  steps jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists recommend_assistant_one_published_idx
  on recommend_assistant_question_sets ((status))
  where status = 'published';
```

### 4.2 TypeScript 型

```ts
// lib/recommend-assistant-config/types.ts
export type AssistantStepKey =
  | "purpose"
  | "budget"
  | "category"
  | "delivery"
  | "additional";

export type AssistantStepConfig = {
  key: AssistantStepKey;
  question: string;
  quickReplies: string[];
  optional: boolean;
  enabled: boolean;
  order: number;
};

export type AssistantQuestionSet = {
  id: string;
  name: string;
  version: number;
  status: "draft" | "published" | "archived";
  steps: AssistantStepConfig[];
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
```

## 5. 設定リポジトリ実装

```ts
// lib/recommend-assistant-config/repository.ts
import { getDb } from "@/lib/neon";
import type { AssistantQuestionSet, AssistantStepConfig } from "./types";

type DbRow = {
  id: string;
  name: string;
  version: number;
  status: "draft" | "published" | "archived";
  steps: unknown;
  meta: unknown;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
};

function mapRow(row: DbRow): AssistantQuestionSet {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    steps: (row.steps as AssistantStepConfig[]) ?? [],
    meta: (row.meta as Record<string, unknown>) ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
  };
}

export async function getPublishedQuestionSet(): Promise<AssistantQuestionSet | null> {
  const db = getDb();
  const rows = (await db`
    select *
    from recommend_assistant_question_sets
    where status = 'published'
    order by published_at desc nulls last
    limit 1
  `) as DbRow[];
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listQuestionSets(): Promise<AssistantQuestionSet[]> {
  const db = getDb();
  const rows = (await db`
    select *
    from recommend_assistant_question_sets
    order by version desc
  `) as DbRow[];
  return rows.map(mapRow);
}

export async function createDraftSet(input: {
  name: string;
  steps: AssistantStepConfig[];
  meta?: Record<string, unknown>;
}): Promise<AssistantQuestionSet> {
  const db = getDb();
  const nextVersionRows = (await db`
    select coalesce(max(version), 0) + 1 as next_version
    from recommend_assistant_question_sets
  `) as Array<{ next_version: number }>;
  const nextVersion = nextVersionRows[0]?.next_version ?? 1;

  const rows = (await db`
    insert into recommend_assistant_question_sets (
      name, version, status, steps, meta
    )
    values (
      ${input.name},
      ${nextVersion},
      'draft',
      ${JSON.stringify(input.steps)}::jsonb,
      ${JSON.stringify(input.meta ?? {})}::jsonb
    )
    returning *
  `) as DbRow[];

  return mapRow(rows[0]);
}

export async function publishSet(id: string): Promise<void> {
  const db = getDb();
  await db`update recommend_assistant_question_sets set status = 'archived' where status = 'published'`;
  await db`
    update recommend_assistant_question_sets
    set status = 'published', published_at = now(), updated_at = now()
    where id = ${id}
  `;
}
```

## 6. メタデータから質問案・選択肢案を生成

```ts
// lib/recommend-assistant-config/candidate-generator.ts
import { getDb } from "@/lib/neon";
import { getRecommendCategoryCandidates } from "@/lib/recommend/category-candidates";
import type { AssistantStepConfig } from "./types";

export async function generateStepDraftsFromMetadata(): Promise<AssistantStepConfig[]> {
  const db = getDb();

  const categoryCandidates = await getRecommendCategoryCandidates(10, 2);
  const categories = categoryCandidates.map((c) => c.name);

  const deliveryRows = (await db`
    select
      sum(case when (metadata->'raw'->>'shipping_frozen_flag')::int = 1 then 1 else 0 end)::int as frozen_count,
      sum(case when (metadata->'raw'->>'shipping_refrigerated_flag')::int = 1 then 1 else 0 end)::int as refrigerated_count,
      sum(case when (metadata->'raw'->>'shipping_ordinary_flag')::int = 1 then 1 else 0 end)::int as ordinary_count,
      sum(case when (metadata->'raw'->>'delivery_hour_flag')::int = 1 then 1 else 0 end)::int as hour_count
    from public.product_text_embeddings
    where metadata is not null
  `) as Array<{
    frozen_count: number;
    refrigerated_count: number;
    ordinary_count: number;
    hour_count: number;
  }>;

  const d = deliveryRows[0] ?? {
    frozen_count: 0,
    refrigerated_count: 0,
    ordinary_count: 0,
    hour_count: 0,
  };
  const delivery = [
    d.frozen_count > 0 ? "冷凍" : null,
    d.refrigerated_count > 0 ? "冷蔵" : null,
    d.ordinary_count > 0 ? "常温" : null,
    d.hour_count > 0 ? "日時指定できる" : null,
    "こだわらない",
  ].filter((v): v is string => !!v);

  return [
    {
      key: "purpose",
      question: "用途を教えてください（自宅用・贈り物など）",
      quickReplies: ["自宅用", "贈り物", "家族向け", "特別な日"],
      optional: false,
      enabled: true,
      order: 1,
    },
    {
      key: "budget",
      question: "ご予算を教えてください（例: 10,001〜20,000円）",
      quickReplies: [
        "〜5,000円",
        "5,001〜10,000円",
        "10,001〜20,000円",
        "20,001〜30,000円",
        "30,001円以上",
      ],
      optional: false,
      enabled: true,
      order: 2,
    },
    {
      key: "category",
      question: "カテゴリは何が良いですか？",
      quickReplies: categories.length > 0 ? categories : ["肉", "魚介", "果物", "米・パン"],
      optional: false,
      enabled: true,
      order: 3,
    },
    {
      key: "delivery",
      question: "配送希望はありますか？",
      quickReplies: delivery,
      optional: true,
      enabled: true,
      order: 4,
    },
    {
      key: "additional",
      question: "追加条件はありますか？（なければ特になし）",
      quickReplies: ["特になし", "卵アレルギーに配慮", "北海道の返礼品"],
      optional: true,
      enabled: true,
      order: 5,
    },
  ];
}
```

## 7. 設定API

### 7.1 案生成API

```ts
// app/api/recommend-assistant-settings/generate/route.ts
import { generateStepDraftsFromMetadata } from "@/lib/recommend-assistant-config/candidate-generator";

export const runtime = "nodejs";

export async function POST() {
  const steps = await generateStepDraftsFromMetadata();
  return Response.json({ ok: true, steps });
}
```

### 7.2 設定一覧/作成API

```ts
// app/api/recommend-assistant-settings/sets/route.ts
import {
  createDraftSet,
  listQuestionSets,
} from "@/lib/recommend-assistant-config/repository";
import type { AssistantStepConfig } from "@/lib/recommend-assistant-config/types";

export const runtime = "nodejs";

export async function GET() {
  const sets = await listQuestionSets();
  return Response.json({ ok: true, sets });
}

type CreatePayload = {
  name: string;
  steps: AssistantStepConfig[];
};

export async function POST(req: Request) {
  const body = (await req.json()) as CreatePayload;
  if (!body.name || !Array.isArray(body.steps) || body.steps.length === 0) {
    return Response.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }
  const created = await createDraftSet({ name: body.name, steps: body.steps });
  return Response.json({ ok: true, set: created });
}
```

### 7.3 公開API

```ts
// app/api/recommend-assistant-settings/publish/route.ts
import { publishSet } from "@/lib/recommend-assistant-config/repository";

export const runtime = "nodejs";

type Payload = { id: string };

export async function POST(req: Request) {
  const body = (await req.json()) as Payload;
  if (!body.id) {
    return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  await publishSet(body.id);
  return Response.json({ ok: true });
}
```

## 8. 設定画面（人手編集）

```tsx
// app/recommend-assistant-settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AssistantStepConfig } from "@/lib/recommend-assistant-config/types";

export default function RecommendAssistantSettingsPage() {
  const [steps, setSteps] = useState<AssistantStepConfig[]>([]);
  const [name, setName] = useState("質問セット草案");
  const [loading, setLoading] = useState(false);

  async function generateDraft() {
    setLoading(true);
    const res = await fetch("/api/recommend-assistant-settings/generate", { method: "POST" });
    const data = await res.json();
    setSteps(data.steps ?? []);
    setLoading(false);
  }

  async function saveDraft() {
    await fetch("/api/recommend-assistant-settings/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, steps }),
    });
  }

  useEffect(() => {
    void generateDraft();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex gap-2">
        <Button onClick={generateDraft} disabled={loading}>候補再生成</Button>
        <Button onClick={saveDraft}>草案保存</Button>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      {steps.map((step, index) => (
        <div key={step.key} className="rounded border p-3 space-y-2">
          <div className="text-sm font-medium">{index + 1}. {step.key}</div>
          <Textarea
            value={step.question}
            onChange={(e) => {
              const next = [...steps];
              next[index] = { ...next[index], question: e.target.value };
              setSteps(next);
            }}
          />
          <Input
            value={step.quickReplies.join(", ")}
            onChange={(e) => {
              const next = [...steps];
              next[index] = {
                ...next[index],
                quickReplies: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
              };
              setSteps(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}
```

## 9. 会話API連携（公開設定の利用）

```ts
// app/api/recommend/conversation/route.ts（要点）
import { getPublishedQuestionSet } from "@/lib/recommend-assistant-config/repository";
import { DEFAULT_QUESTION_SET } from "@/lib/recommend-assistant-config/default-config";

const published = await getPublishedQuestionSet();
const activeSteps = published?.steps?.length ? published.steps : DEFAULT_QUESTION_SET.steps;

// 既存の getQuestionState / buildNextQuestion / getQuestionQuickReplies は
// activeSteps を引数に受け取れるように拡張して利用する。
```

## 10. テスト計画

1. `tests/api/recommend-assistant-settings.test.ts`
   - 生成APIが `steps` を返す
   - 保存APIが draft を作成する
   - 公開APIで published が1件に保たれる
2. `tests/api/recommend-conversation.test.ts`
   - 公開設定がある場合はその質問文/選択肢が返る
   - 公開設定がない場合はデフォルトにフォールバックする
3. 既存回帰
   - `/chat-recommend` `/agent-recommend` `/recommend-assistant` が壊れない

## 11. 実装順序

1. DBマイグレーション追加
2. 型・リポジトリ実装
3. 案生成ロジック実装
4. 設定API実装（generate/sets/publish）
5. 設定画面実装
6. conversation API の設定参照化
7. テスト追加・回帰確認

## 12. 受け入れ条件

- 設定画面で「候補再生成 → 編集 → 保存 → 公開」ができる
- 公開後に `/recommend-assistant` の質問文・選択肢が切り替わる
- 設定未公開時は既存デフォルト挙動で動く
- `npm run lint` と `npm run test:run` が通る

## 13. 追加スコープ（2026-02-17）

### 13.1 背景

- 設定画面で質問文・選択肢の編集は可能だが、ステップの追加/削除/順序変更ができない。
- 運用で質問導線を試行錯誤できるよう、画面上での並び替えと増減をサポートする。

### 13.2 追加要件

- `/recommend-assistant-settings` で以下を可能にする。
  - ステップ削除
  - ステップ追加（未使用キーから選択）
  - ステップ順序変更（上へ/下へ）
- 保存時に `order` を再採番して送信する。
- API 側で `steps.key` の重複を拒否し、無効な設定を保存させない。

### 13.3 変更ファイル（追加分）

| 種別 | パス | 目的 |
|---|---|---|
| 変更 | `app/recommend-assistant-settings/page.tsx` | 追加/削除/並び替えUIと保存前正規化 |
| 変更 | `app/api/recommend-assistant-settings/sets/route.ts` | 重複キー検証 |
| 変更 | `tests/api/recommend-assistant-settings.test.ts` | 重複キー拒否の回帰テスト |
