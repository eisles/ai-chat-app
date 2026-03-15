# Completion Checklist
- 変更後に関連するテストを実行する。最低でも `npm run test:run` の対象絞り込みや、必要に応じて `npm run lint` を検討する。
- 大きな構造変更なら `npm run build` で App Router / route handler の破綻がないか確認する。
- `.kiro/steering/` を更新する場合は、パターンと原則だけを書く。ファイル一覧や依存関係の羅列は避ける。
- 既存のユーザー編集を上書きしない。steering は additive に更新する。
- セキュリティ関連の env や DB 接続文字列はドキュメントに書かない。