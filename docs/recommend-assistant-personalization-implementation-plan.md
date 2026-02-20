# 対話型レコメンド個人化 実装計画（クリック履歴ベース）

## 1. 目的
- `/recommend-assistant` の商品クリック履歴を用いて、同一ブラウザ内ユーザに最適化した推薦順位を返す。
- ユーザ識別は `localStorage` に保持する UUID を使い、ログインなしで匿名運用する。
- 既存の `/chat-recommend` `/agent-recommend` `/recommend-assistant` の基本導線は壊さない。

## 2. スコープ
- 対象画面: `/recommend-assistant` のみ（MVP）。
- 対象機能:
- 商品クリックイベント収集
- 匿名ユーザID発行・保持
- 会話推薦APIへの `userId` 受け渡し
- クリック履歴ベース再スコアリング
- 推薦理由の表示（個人化由来）
- 非対象（MVP外）:
- ログインユーザ連携
- クロスデバイス同期
- `/chat-recommend` `/agent-recommend` への展開

## 3. データモデル設計
### 3.1 Migration
- 追加ファイル: `migrations/20260220_recommend_personalization_events.sql`

```sql
create table if not exists public.recommend_click_events (
  id uuid primary key,
  user_id uuid not null,
  source text not null default 'recommend-assistant',
  product_id text not null,
  city_code text null,
  score double precision null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_recommend_click_events_user_created_at
  on public.recommend_click_events (user_id, created_at desc);

create index if not exists idx_recommend_click_events_product_id
  on public.recommend_click_events (product_id);
```

### 3.2 保持方針
- 保存期間: 90日（後続で定期削除バッチまたはSQL運用）。
- 保存するのは匿名 `user_id` と行動情報のみ。個人情報は持たない。

## 4. API設計
### 4.1 クリックイベント収集API
- 追加: `app/api/recommend/events/click/route.ts`

#### Request
```json
{
  "userId": "uuid-v4",
  "productId": "12345",
  "cityCode": "01234",
  "source": "recommend-assistant",
  "score": 0.8231,
  "metadata": {
    "queryText": "カテゴリ: 旅行・体験\n用途: 自宅用"
  }
}
```

#### Response
```json
{ "ok": true }
```

#### バリデーション
- `userId`: UUID v4
- `productId`: 非空文字列
- `source`: 既定値 `recommend-assistant`
- 不正値は `400`

### 4.2 会話推薦API拡張
- 変更: `app/api/recommend/conversation/route.ts`
- 既存ペイロードに `userId?: string` を追加。
- `recommendByAnswers` 呼び出し時に `userId` を渡す（任意）。

```ts
type Payload = {
  message?: unknown;
  session?: ConversationSession;
  topK?: unknown;
  threshold?: unknown;
  selectedStepKey?: unknown;
  selectedValue?: unknown;
  userId?: unknown;
};
```

### 4.3 個人化LLM利用フラグ
- 制御は `env` + `request` の二段で行う。
- `env`: `RECOMMEND_PERSONALIZATION_LLM_ENABLED=true|false`（デフォルト `false`）
- `request`: `useLlmPersonalization?: boolean`（デフォルト `false`）
- 最終判定: `finalUseLlm = envEnabled && request.useLlmPersonalization === true`
- いずれかが `false` ならルールベース集計のみ。
- LLM失敗時はルールベースへ自動フォールバック（レスポンス失敗にしない）。

```ts
type Payload = {
  message?: unknown;
  session?: ConversationSession;
  topK?: unknown;
  threshold?: unknown;
  selectedStepKey?: unknown;
  selectedValue?: unknown;
  userId?: unknown;
  useLlmPersonalization?: unknown;
};

const envEnabled = process.env.RECOMMEND_PERSONALIZATION_LLM_ENABLED === "true";
const requestEnabled = body.useLlmPersonalization === true;
const finalUseLlm = envEnabled && requestEnabled;
```

## 5. サーバ実装設計
### 5.1 ユーザ行動リポジトリ
- 追加: `lib/recommend-personalization/repository.ts`
- 役割:
- `insertClickEvent(input)`
- `getRecentClicksByUser(userId, limit)`
- `getProductSignals(productIds)`（必要なら `product_text_embeddings` 参照）

```ts
export async function getRecentClicksByUser(
  userId: string,
  limit = 30
): Promise<ClickEvent[]> {
  const db = getDb();
  return (await db`
    select user_id, product_id, city_code, score, metadata, created_at
    from public.recommend_click_events
    where user_id = ${userId}::uuid
    order by created_at desc
    limit ${limit}
  `) as ClickEvent[];
}
```

### 5.2 プロファイル生成
- 追加: `lib/recommend-personalization/profile.ts`
- 直近クリックから以下を作る:
- `preferredCategories: Map<string, number>`
- `preferredKeywords: Map<string, number>`
- `recentProductIds: Set<string>`
- `finalUseLlm === false` の場合は頻度集計のみで構築。
- `finalUseLlm === true` の場合はクリック商品テキストをLLM要約し、`preferredKeywords` を補強。

```ts
export type UserPreferenceProfile = {
  categoryWeights: Record<string, number>;
  keywordWeights: Record<string, number>;
  recentProductIds: string[];
};
```

```ts
export type BuildProfileOptions = {
  useLlmPersonalization: boolean;
};
```

### 5.3 再スコアリング
- 追加: `lib/recommend-personalization/rerank.ts`
- 入力: `SearchMatch[]` + `UserPreferenceProfile` + 現在条件
- 出力: `SearchMatch[]`（`personalBoost` と `personalReasons` を付与）

```ts
const PERSONAL_BOOST = {
  categoryMatch: 0.12,
  keywordMatchMax: 0.10,
  recentClickSameProductPenalty: -0.05,
};

export function applyPersonalization(
  matches: SearchMatch[],
  profile: UserPreferenceProfile | null
): SearchMatch[] {
  if (!profile) return matches;
  return matches
    .map((m) => {
      const boost = calcBoost(m, profile);
      return { ...m, score: m.score + boost.value, personalBoost: boost.value, personalReasons: boost.reasons };
    })
    .sort((a, b) => b.score - a.score);
}
```

### 5.4 LLMキーワード補強（任意）
- 追加: `lib/recommend-personalization/llm-keywords.ts`
- 入力: 直近クリック商品のテキスト一覧
- 出力: `string[]`（上位キーワード）
- タイムアウトまたは失敗時は空配列を返し、ルールベース結果を採用。

```ts
export async function generatePreferenceKeywordsByLlm(
  clickedTexts: string[]
): Promise<string[]> {
  if (clickedTexts.length === 0) return [];
  // 失敗時は throw ではなく [] を返す実装にする
  return [];
}
```

### 5.5 `recommendByAnswers` への統合
- 変更: `lib/recommend/by-answers-engine.ts`
- `RecommendByAnswersInput` に `userId?: string` と `useLlmPersonalization?: boolean` を追加。
- 既存フィルタ（予算/カテゴリ/配送）の後段で個人化再スコアリングを適用。
- `userId` なし、履歴なしの場合は現行挙動を維持。

```ts
export type RecommendByAnswersInput = {
  budget?: string;
  category?: string;
  purpose?: string;
  delivery?: string[];
  allergen?: string;
  prefecture?: string;
  cityCode?: string;
  topK?: number;
  threshold?: number;
  queryText?: string;
  userId?: string;
  useLlmPersonalization?: boolean;
};
```

## 6. フロント実装設計
### 6.1 匿名ユーザID管理
- 追加: `lib/recommend-personalization/client-user-id.ts`

```ts
const STORAGE_KEY = "recommend_user_id";

export function getOrCreateRecommendUserId(): string {
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, created);
  return created;
}
```

### 6.2 イベント送信
- 変更: `app/recommend-assistant/page.tsx`
- カードクリック時に `sendBeacon` で `POST /api/recommend/events/click`
- `submitMessage()` の会話API呼び出しに `userId` を追加

```ts
const userId = getOrCreateRecommendUserId();

await fetch("/api/recommend/conversation", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: userText,
    session,
    topK: topK ? Number(topK) : undefined,
    threshold: threshold ? Number(threshold) : undefined,
    selectedStepKey: options?.selectedStepKey ?? undefined,
    selectedValue: options?.selectedStepKey ? userText : undefined,
    userId,
    useLlmPersonalization: useLlmPersonalizationUi,
  }),
});
```

```ts
function trackClick(payload: ClickPayload) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/recommend/events/click", blob)) return;
  }
  void fetch("/api/recommend/events/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
}
```

### 6.3 表示
- 推薦カードに以下を追加:
- `personalBoost > 0` なら `あなた向け` バッジ
- 理由文（例: `最近のクリック傾向（旅行・体験）に一致`）

## 7. テスト計画
### 7.1 APIテスト
- 追加: `tests/api/recommend-events-click.test.ts`
- 正常: UUID + productId で `200`
- 異常: UUID不正で `400`

### 7.2 推薦テスト
- 追加/更新: `tests/api/recommend-conversation.test.ts`
- `userId` あり・履歴ありで順位が変わる
- `userId` なしで従来同等
- 既存 `selectedStepKey/selectedValue` 導線が壊れない

### 7.3 ユニットテスト
- 追加:
- `tests/lib/recommend-personalization/profile.test.ts`
- `tests/lib/recommend-personalization/rerank.test.ts`

## 8. 実装タスク（順序）
1. Migration作成・適用
2. クリックイベントAPI作成
3. `localStorage` UUIDユーティリティ作成
4. `/recommend-assistant` クリック送信実装
5. 会話APIに `userId` 追加
6. プロファイル生成 + 再スコア実装（ルールベース）
7. `LLMフラグ制御` と `LLMキーワード補強` 実装（env + request）
8. UIバッジ/理由表示
9. テスト追加・更新
10. lint/test 実行

## 9. 受け入れ条件
- 同一ブラウザで `userId` が維持される。
- 商品クリックで `recommend_click_events` に記録される。
- 履歴ありユーザでは推薦順位が変化する。
- 履歴なしでは現行挙動と同等。
- `RECOMMEND_PERSONALIZATION_LLM_ENABLED=false` の場合、`useLlmPersonalization=true` でもLLM経路に入らない。
- `RECOMMEND_PERSONALIZATION_LLM_ENABLED=true` かつ `useLlmPersonalization=true` の場合のみLLM経路に入る。
- LLM失敗時はエラーにせずルールベースで結果を返す。
- `/chat-recommend` `/agent-recommend` `/recommend-assistant` の既存機能を壊さない。

## 10. 将来拡張
- `/chat-recommend` `/agent-recommend` への展開
- セッション内即時学習（クリック直後に再ランキング）
- 埋め込み重心の事前集計テーブル化
