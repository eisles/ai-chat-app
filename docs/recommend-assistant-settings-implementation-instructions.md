# Recommend Assistant Settings 実装指示（新セッション用）

`docs/recommend-assistant-settings-implementation-plan.md` に従って実装してください。

必ず最初に以下を読んでください。
1. `docs/recommend-assistant-settings-implementation-plan.md`
2. `docs/recommend-assistant-implementation-plan.md`
3. `app/api/recommend/conversation/route.ts`
4. `lib/recommend-conversation/session.ts`
5. `app/recommend-assistant/page.tsx`

実施ルール:
1. 既存の `/chat-recommend` `/agent-recommend` `/recommend-assistant` は破壊しないこと
2. 既存の `selectedStepKey/selectedValue` ロジックは維持すること
3. 実装は end-to-end で完了まで進めること
4. 進捗管理用に `docs/recommend-assistant-settings-tasks.md` を作成し、タスク完了ごとにチェックを更新すること
5. 失敗したタスクがあれば理由を同ファイルに追記すること

必須実装:
1. マイグレーション追加  
   `migrations/20260217_recommend_assistant_question_sets.sql`
2. 設定スキーマ/デフォルト/リポジトリ実装  
   `lib/recommend-assistant-config/types.ts`  
   `lib/recommend-assistant-config/default-config.ts`  
   `lib/recommend-assistant-config/repository.ts`
3. メタデータ起点の質問案・選択肢案生成  
   `lib/recommend-assistant-config/candidate-generator.ts`
4. 設定API追加  
   `app/api/recommend-assistant-settings/generate/route.ts`  
   `app/api/recommend-assistant-settings/sets/route.ts`  
   `app/api/recommend-assistant-settings/publish/route.ts`
5. 設定画面追加  
   `app/recommend-assistant-settings/page.tsx`
6. 会話APIを公開設定参照に変更  
   `app/api/recommend/conversation/route.ts`
7. セッション制御を外部ステップ注入対応に拡張  
   `lib/recommend-conversation/session.ts`
8. テスト追加/更新  
   `tests/api/recommend-assistant-settings.test.ts`  
   `tests/api/recommend-conversation.test.ts`

受け入れ条件:
1. 設定画面で「候補再生成 → 編集 → 保存(draft) → 公開(published)」ができる
2. 公開後、`/recommend-assistant` の質問文と選択肢が反映される
3. 公開設定がない場合、デフォルト設定で正常動作する
4. 既存画面の挙動を壊さない

実装後に実行:
1. `npm run lint -- app/api/recommend/conversation/route.ts app/api/recommend-assistant-settings/generate/route.ts app/api/recommend-assistant-settings/sets/route.ts app/api/recommend-assistant-settings/publish/route.ts app/recommend-assistant-settings/page.tsx lib/recommend-assistant-config/types.ts lib/recommend-assistant-config/default-config.ts lib/recommend-assistant-config/repository.ts lib/recommend-assistant-config/candidate-generator.ts lib/recommend-conversation/session.ts tests/api/recommend-assistant-settings.test.ts tests/api/recommend-conversation.test.ts`
2. `npm run test:run`（可能なら必ず実行）

最後に以下フォーマットで報告:
1. 変更ファイル一覧
2. 実装内容サマリ
3. `docs/recommend-assistant-settings-tasks.md` の最終状態
4. lint/test 結果
5. 未対応事項・リスク（あれば）
