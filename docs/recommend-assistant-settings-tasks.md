# Recommend Assistant Settings 実装タスク

- [x] マイグレーション追加（`migrations/20260217_recommend_assistant_question_sets.sql`）
- [x] 設定スキーマ/デフォルト/リポジトリ実装
- [x] メタデータ起点の質問案・選択肢案生成
- [x] 設定API追加（generate/sets/publish）
- [x] 設定画面追加（`/recommend-assistant-settings`）
- [x] 会話APIを公開設定参照に変更
- [x] セッション制御を外部ステップ注入対応に拡張
- [x] テスト追加/更新
- [x] lint 実行
- [x] test 実行

## 失敗したタスク

- なし

## 追加要望対応（2026-02-17）

- [x] 実装計画の追加スコープを更新
- [x] 設定画面にステップ追加/削除/並び替えを実装
- [x] 保存時の `order` 再採番を実装
- [x] 設定APIで重複キー検証を実装
- [x] APIテストに重複キー拒否ケースを追加
- [x] 追加分 lint 実行
- [x] 追加分 test 実行
