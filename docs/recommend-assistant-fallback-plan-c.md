# Recommend Assistant 条件緩和可視化（C案）実装計画

## 1. 目的
- 条件緩和が発生した事実をユーザーが画面上で認識できるようにする。
- 条件緩和の挙動をユーザーがON/OFFできるようにする。
- 条件緩和の発生状況をイベントとして記録し、改善検証に使えるようにする。

## 2. 対象範囲
- 対象画面: `/recommend-assistant`
- 対象API:
  - `/api/recommend/conversation`
  - `/api/recommend/by-answers`
- 対象ロジック:
  - `lib/recommend/by-answers-engine.ts`
- 対象イベント:
  - 新規 `recommend_search_events`（条件緩和イベント）

## 3. 仕様（ユーザー体験）
### 3.1 自動条件緩和トグル
- ラベル: `自動で条件緩和する`
- 初期値: `ON`
- 保持: `localStorage`（キー例: `recommend_assistant_auto_relax`）
- 挙動:
  - `ON`: 既存のカテゴリ0件フォールバックを有効化
  - `OFF`: 厳密条件でのみ検索

### 3.2 条件緩和の可視化
- 条件緩和が適用された場合、結果ブロック先頭に通知バナーを表示。
- 表示内容:
  - `カテゴリに一致する商品がなかったため、カテゴリ条件を緩和して表示しています。`
  - `緩和条件: カテゴリ`
  - `厳密一致件数: 0件`
  - `緩和後件数: N件`

### 3.3 再操作導線
- バナーに以下の操作を配置:
  - `厳密条件で再検索`（1回のみ `allowCategoryFallback=false` で再送）
  - `カテゴリを変更`（カテゴリ入力の誘導）

### 3.4 理由ラベル整合
- 商品カードの `カテゴリ一致` は実際にカテゴリ一致した商品にのみ表示。
- 条件緩和で残った非一致商品には `カテゴリ一致` を表示しない。

## 4. API契約
### 4.1 リクエスト追加（後方互換）
- `allowCategoryFallback?: boolean`
  - 未指定時は `true` として扱う（既存UI影響なし）

### 4.2 レスポンス追加（後方互換）
- `fallbackInfo?: { ... }`

```json
{
  "fallbackInfo": {
    "enabled": true,
    "applied": true,
    "reason": "category_no_match",
    "relaxedConditions": ["category"],
    "strictMatchCount": 0,
    "relaxedMatchCount": 4
  }
}
```

## 5. バックエンド実装
### 5.1 `recommendByAnswers` の拡張
- `allowCategoryFallback` を入力型に追加。
- `categoryFiltered.length === 0` かつ `allowCategoryFallback=true` の時のみカテゴリ条件を外す。
- 返却値に `fallbackInfo` を追加。

### 5.2 ルート反映
- `/api/recommend/conversation` で `allowCategoryFallback` を受け取り `recommendByAnswers` に渡す。
- `/api/recommend/by-answers` も同様に受け取り可能にする。

## 6. イベント記録
### 6.1 新規テーブル
- マイグレーション追加: `migrations/20260304_recommend_search_events.sql`
- テーブル:
  - `id uuid pk`
  - `user_id uuid null`
  - `source text not null`
  - `event_type text not null`（`recommend_fallback_applied`）
  - `metadata jsonb null`
  - `created_at timestamptz not null default now()`

### 6.2 記録条件
- `fallbackInfo.applied === true` の場合のみ記録。
- 記録失敗は検索APIの失敗にしない（ログ失敗は握りつぶす）。

### 6.3 metadata 例
- `reason`
- `relaxedConditions`
- `strictMatchCount`
- `relaxedMatchCount`
- `topK`
- `threshold`
- `slots`（目的・予算・カテゴリなど）
- `allowCategoryFallback`

## 7. フロント実装
### 7.1 state追加
- `allowCategoryFallback`（トグル状態）
- `fallbackInfo`（APIレスポンス保持）

### 7.2 送信変更
- 会話送信時に `allowCategoryFallback` を body に追加。

### 7.3 表示変更
- `fallbackInfo.applied` 時に通知バナーと導線を表示。
- `厳密条件で再検索` 押下時は一時的に `allowCategoryFallback=false` で再送。

## 8. テスト計画
### 8.1 APIテスト
- `allowCategoryFallback=true` でカテゴリ0件時に `fallbackInfo.applied=true` となる。
- `allowCategoryFallback=false` でカテゴリ0件時に `fallbackInfo.applied=false` かつ0件維持。
- `fallbackInfo.applied=true` 時に `recommend_fallback_applied` 記録が呼ばれる。

### 8.2 UIテスト（最低限）
- トグルON/OFFでAPI送信値が変わる。
- 条件緩和時に通知バナーが表示される。
- `厳密条件で再検索` で0件に戻ることを確認できる。

### 8.3 実行コマンド
- `npm run test:run -- tests/api/recommend-conversation.test.ts`
- `npm run build`

## 9. リリース手順
1. マイグレーション適用（`recommend_search_events`）
2. API契約拡張とフォールバック情報返却
3. UIトグル・バナー・導線実装
4. テスト実行
5. ステージングでイベント記録確認

## 10. 受け入れ条件
- 条件緩和発生時にユーザーが画面で認識できる。
- ユーザーが自動条件緩和をON/OFFできる。
- 条件緩和イベントが記録される。
- 既存クライアント互換を壊さない（追加フィールドは任意）。
