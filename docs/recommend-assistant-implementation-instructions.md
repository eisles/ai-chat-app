# Recommend Assistant 実装指示（新セッション用）

`docs/recommend-assistant-implementation-plan.md` に従って実装してください。

## 前提

- `/chat-recommend` はプロトタイプとして保持し、既存挙動を変更しないこと
- 新機能は別画面 `/recommend-assistant` として追加すること

## 必須実装

1. `lib/recommend/by-answers-engine.ts` を新規作成し、回答ベース検索ロジックを共通化
2. `app/api/recommend/by-answers/route.ts` を共通エンジン呼び出しに置換（レスポンス互換維持）
3. `lib/recommend-conversation/types.ts` / `lib/recommend-conversation/session.ts` / `lib/recommend-conversation/extract.ts` を追加
4. `app/api/recommend/conversation/route.ts` を追加（`action: ask | recommend` を返す）
5. `app/recommend-assistant/page.tsx` を追加（会話UI + 商品カード表示）
6. `app/layout.tsx` に `/recommend-assistant` ナビを追加
7. `tests/api/recommend-conversation.test.ts` を追加

## 受け入れ条件

- `/chat-recommend` と `/agent-recommend` は既存通り動作
- `/recommend-assistant` で「条件不足時は追質問」「条件充足時は推薦表示」が動作
- 以下の lint を実行して結果を報告

```bash
npm run lint -- app/recommend-assistant/page.tsx app/api/recommend/conversation/route.ts app/api/recommend/by-answers/route.ts
```

- 可能なら以下の test を実行して結果を報告

```bash
npm run test:run
```

## 最終報告フォーマット

- 変更ファイル一覧
- 実装内容サマリ
- テスト実行結果
- 未対応事項（あれば）

