# 対話型レコメンド個人化 実装タスク

## 進捗
- [x] Migration追加（`migrations/20260220_recommend_personalization_events.sql`）
- [x] クリックイベントAPI（`app/api/recommend/events/click/route.ts`）
- [x] 個人化リポジトリ/プロファイル/再スコア/LLM補強（`lib/recommend-personalization/*`）
- [x] クライアントUUID管理（`lib/recommend-personalization/client-user-id.ts`）
- [x] 会話API拡張（`app/api/recommend/conversation/route.ts`）
- [x] 回答ベース検索統合（`lib/recommend/by-answers-engine.ts`）
- [x] フロント実装（`app/recommend-assistant/page.tsx`）
- [x] 商品詳細モーダル追加（モーダル内クリックを興味イベントとして送信）
- [x] 画像ベクトル類似検索結果カードにも商品詳細モーダル導線を追加
- [x] AIエージェントおすすめAPI追加（`app/api/recommend/agent-personalized/route.ts`）
- [x] `AIエージェントにおすすめを聞く` ボタンと別ブロック表示を実装
- [x] AIエージェントおすすめの「抽出内容」表示（現在条件 / クリック履歴シグナル / 再スコアルール）
- [x] AIエージェントおすすめを「履歴優先検索→0件時に現在条件へフォールバック」に変更
- [x] クリック履歴から金額レンジを推定し、履歴優先検索で金額条件として適用
- [x] エージェントのおすすめカードにも「この画像に似た商品を検索」導線を追加
- [x] AIエージェント処理中のローディング演出を強化（スピナー＋進行メッセージ＋スケルトン）
- [x] 配送希望（ステップ4）の選択肢を「特になし」先頭に統一（旧「こだわらない」を置換）
- [x] 旅行・体験系カテゴリ時は配送ステップ（4）を自動スキップ
- [x] 保存済みセットの「編集読み込み」を設定画面に追加
- [x] 保存済みセット削除を設定画面に追加（公開中セットは削除不可）
- [x] 設定APIに `PATCH/DELETE /api/recommend-assistant-settings/sets/{id}` を追加
- [x] LLM個人化の有効条件（env+UI）を `recommend-assistant` 画面に明記
- [x] LLM個人化を有効にした場合の検索仕様を `recommend-assistant` 画面に明記
- [x] テスト追加/更新（`tests/api/recommend-events-click.test.ts` ほか）
- [x] lint/test 実行

## 失敗タスク
- なし
