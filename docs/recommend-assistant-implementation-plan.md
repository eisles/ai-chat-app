# 対話型レコメンド新画面 実装計画

作成日: 2026-02-17  
対象リポジトリ: `ai-chat-app`

## 1. 実装方針

- 既存の `/chat-recommend` は **プロトタイプとしてそのまま保持** する（既存機能・UIは変更しない）。
- 対話型の新しい導線を **別画面** で追加する。
- 新画面は `/recommend-assistant` とし、API は `app/api/recommend/conversation/route.ts` を新設する。
- 既存の回答ベース検索ロジック（`/api/recommend/by-answers`）は共通化して再利用する。

## 2. ゴールと非ゴール

### ゴール

- ユーザーの自然文入力から、予算・カテゴリ・用途などの条件を段階的に抽出する。
- 条件不足時は追質問し、条件が揃ったら商品カードを表示する。
- 推薦結果に「なぜ選ばれたか（予算一致・カテゴリ一致など）」を表示する。

### 非ゴール（MVP外）

- 長期ユーザー履歴の永続保存
- 複雑なランキング学習（Bandit/強化学習）
- 管理画面側の分析ダッシュボード

## 3. 追加・変更ファイル

| 種別 | パス | 目的 |
|---|---|---|
| 追加 | `app/recommend-assistant/page.tsx` | 新しい対話型レコメンド画面 |
| 追加 | `app/api/recommend/conversation/route.ts` | 対話ターンAPI |
| 追加 | `lib/recommend-conversation/types.ts` | 型定義 |
| 追加 | `lib/recommend-conversation/session.ts` | スロット統合・不足判定・次質問生成 |
| 追加 | `lib/recommend-conversation/extract.ts` | ユーザー発話から条件抽出 |
| 追加 | `lib/recommend/by-answers-engine.ts` | 回答条件からの検索共通エンジン |
| 変更 | `app/api/recommend/by-answers/route.ts` | 共通エンジンを呼び出す薄いRoute化 |
| 変更 | `app/layout.tsx` | ナビに `/recommend-assistant` を追加 |
| 追加 | `tests/api/recommend-conversation.test.ts` | APIテスト |

## 4. 実装ステップ（コード例付き）

### Step 1: 回答ベース検索ロジックを共通化

`/api/recommend/by-answers` のロジックを `lib/recommend/by-answers-engine.ts` に切り出す。

```ts
// lib/recommend/by-answers-engine.ts
import { generateTextEmbedding, searchTextEmbeddings } from "@/lib/image-text-search";

export type RecommendInput = {
  budget?: string;
  category?: string;
  purpose?: string;
  delivery?: string[];
  allergen?: string;
  prefecture?: string;
  cityCode?: string;
  topK?: number;
  threshold?: number;
};

export async function recommendByAnswers(input: RecommendInput) {
  const queryText = [
    input.category ? `カテゴリ: ${input.category}` : "",
    input.purpose ? `用途: ${input.purpose}` : "",
    input.delivery?.length ? `配送条件: ${input.delivery.join(" / ")}` : "",
    input.allergen && input.allergen !== "なし" ? `アレルゲン配慮: ${input.allergen}` : "",
    input.prefecture ? `都道府県: ${input.prefecture}` : "",
    input.cityCode ? `市町村コード: ${input.cityCode}` : "",
  ].filter(Boolean).join("\n");

  const embedding = await generateTextEmbedding(queryText);
  const matches = await searchTextEmbeddings({
    embedding: embedding.vector,
    topK: input.topK ?? 10,
    threshold: input.threshold ?? 0.35,
  });

  return { queryText, matches };
}
```

### Step 2: 会話状態と質問制御を追加

```ts
// lib/recommend-conversation/types.ts
export type SlotState = {
  budget?: string;
  category?: string;
  purpose?: string;
  delivery?: string[];
  allergen?: string;
  prefecture?: string;
  cityCode?: string;
  negativeKeywords?: string[];
};

export type ConversationSession = {
  slots: SlotState;
  askedKeys: string[];
};
```

```ts
// lib/recommend-conversation/session.ts
import type { SlotState } from "./types";

const REQUIRED_KEYS: Array<keyof SlotState> = ["budget", "category", "purpose"];

export function mergeSlots(base: SlotState, patch: SlotState): SlotState {
  return {
    ...base,
    ...patch,
    delivery: patch.delivery ?? base.delivery ?? [],
    negativeKeywords: patch.negativeKeywords ?? base.negativeKeywords ?? [],
  };
}

export function getMissingKeys(slots: SlotState): Array<keyof SlotState> {
  return REQUIRED_KEYS.filter((k) => !slots[k] || String(slots[k]).trim().length === 0);
}

export function buildNextQuestion(slots: SlotState): string | null {
  const missing = getMissingKeys(slots);
  if (missing.length === 0) return null;
  if (missing[0] === "budget") return "ご予算を教えてください（例: 10,001〜20,000円）";
  if (missing[0] === "category") return "カテゴリは何が良いですか？（肉・魚介・果物など）";
  return "用途を教えてください（自宅用・贈り物など）";
}
```

### Step 3: ユーザー発話から条件抽出

```ts
// lib/recommend-conversation/extract.ts
import { createCompletion } from "@/lib/llm-providers";
import type { SlotState } from "./types";

const MODEL = "openai:gpt-4o-mini";

export async function extractSlots(message: string): Promise<SlotState> {
  const response = await createCompletion({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "日本語文から購買条件を抽出し、JSONのみ返す。" +
          "keys: budget, category, purpose, delivery(array), allergen, prefecture, cityCode, negativeKeywords(array)。",
      },
      { role: "user", content: message },
    ],
    temperature: 0.1,
    maxTokens: 300,
  });

  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : "{}") as SlotState;
}
```

### Step 4: 対話ターンAPIを実装

```ts
// app/api/recommend/conversation/route.ts
import { recommendByAnswers } from "@/lib/recommend/by-answers-engine";
import { extractSlots } from "@/lib/recommend-conversation/extract";
import { mergeSlots, buildNextQuestion, getMissingKeys } from "@/lib/recommend-conversation/session";
import type { ConversationSession } from "@/lib/recommend-conversation/types";

export const runtime = "nodejs";

type Payload = {
  message: string;
  session?: ConversationSession;
  topK?: number;
  threshold?: number;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Payload;
  const current = body.session ?? { slots: {}, askedKeys: [] };

  const extracted = await extractSlots(body.message);
  const slots = mergeSlots(current.slots, extracted);
  const nextQuestion = buildNextQuestion(slots);

  if (nextQuestion) {
    return Response.json({
      ok: true,
      action: "ask",
      session: { ...current, slots },
      missingKeys: getMissingKeys(slots),
      assistantMessage: nextQuestion,
    });
  }

  const result = await recommendByAnswers({
    ...slots,
    topK: body.topK ?? 10,
    threshold: body.threshold ?? 0.35,
  });

  return Response.json({
    ok: true,
    action: "recommend",
    session: { ...current, slots },
    assistantMessage: "条件が揃いました。おすすめ結果を表示します。",
    queryText: result.queryText,
    matches: result.matches,
  });
}
```

### Step 5: 新画面 `/recommend-assistant` を追加

```tsx
// app/recommend-assistant/page.tsx（抜粋）
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function RecommendAssistantPage() {
  const [session, setSession] = useState({ slots: {}, askedKeys: [] as string[] });
  const [messages, setMessages] = useState([{ role: "assistant", text: "ご希望条件を教えてください。" }]);
  const [input, setInput] = useState("");
  const [matches, setMatches] = useState<any[]>([]);

  async function onSend() {
    const userText = input.trim();
    if (!userText) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userText }]);

    const res = await fetch("/api/recommend/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText, session }),
    });
    const data = await res.json();
    setSession(data.session);
    setMessages((prev) => [...prev, { role: "assistant", text: data.assistantMessage }]);
    setMatches(data.matches ?? []);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <Card className="p-4">
        {/* 会話UI */}
      </Card>
      <div>{/* 商品カードUI */}</div>
      <Input value={input} onChange={(e) => setInput(e.target.value)} />
      <Button onClick={onSend}>送信</Button>
    </div>
  );
}
```

### Step 6: ナビゲーション追加（既存画面は保持）

`app/layout.tsx` の `navLinks` に以下を追加する。

```ts
{ href: "/chat-recommend", label: "チャット履歴レコメンド" }, // 既存そのまま
{ href: "/recommend-assistant", label: "対話型レコメンド" },   // 新規
```

### Step 7: テスト追加

```ts
// tests/api/recommend-conversation.test.ts（骨子）
import { describe, it, expect } from "vitest";

describe("recommend conversation api", () => {
  it("必須スロット不足時は ask を返す", async () => {
    expect(true).toBe(true);
  });

  it("必須スロット充足時は recommend を返す", async () => {
    expect(true).toBe(true);
  });
});
```

## 5. API仕様（MVP）

### Request

```json
{
  "message": "1万円前後で魚介がほしい",
  "session": {
    "slots": {},
    "askedKeys": []
  },
  "topK": 10,
  "threshold": 0.35
}
```

### Response（追質問）

```json
{
  "ok": true,
  "action": "ask",
  "assistantMessage": "用途を教えてください（自宅用・贈り物など）",
  "missingKeys": ["purpose"],
  "session": {
    "slots": {
      "budget": "10,001〜20,000円",
      "category": "魚介"
    },
    "askedKeys": []
  }
}
```

### Response（推薦）

```json
{
  "ok": true,
  "action": "recommend",
  "assistantMessage": "条件が揃いました。おすすめ結果を表示します。",
  "queryText": "カテゴリ: 魚介\n用途: 自宅用",
  "matches": []
}
```

## 6. 開発順序と完了条件

1. `lib/recommend/by-answers-engine.ts` 作成と既存Route置換  
完了条件: `/api/recommend/by-answers` の既存レスポンスが変わらない。

2. 会話API実装  
完了条件: 未充足時に `action: ask`、充足時に `action: recommend` を返す。

3. 新画面実装  
完了条件: `/recommend-assistant` で会話し、商品カードが出る。

4. テスト追加  
完了条件: `npm run test:run` で新規テストが通る。

5. 動作確認  
完了条件: `/chat-recommend` が既存通り動き、影響がない。

## 7. リスクと対策

- 抽出JSONが壊れるリスク  
対策: JSON抽出失敗時は空オブジェクトにフォールバックし、追質問に戻す。

- 会話が長くなり条件が矛盾するリスク  
対策: 最新入力を優先し、`session.slots` を上書き統合する。

- 結果0件の体験悪化  
対策: 条件緩和（threshold引き下げ、delivery条件をソフト化）を次フェーズで追加する。

