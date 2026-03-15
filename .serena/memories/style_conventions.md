# Style And Conventions
- ユーザー向け応答は日本語。コード識別子は英語。
- TypeScript strict を前提に、API の入出力型は明示する。
- `@/` エイリアスを広く使い、同一ディレクトリ内の小さな helper だけ相対 import を使う。
- Route Handler は入力検証・フラグ判定・エラーハンドリング中心にし、業務ロジックは `lib/*` へ寄せる方針。
- 画面ディレクトリ配下に `table-client.tsx` や `actions-client.tsx` を置き、page 本体から局所 UI 状態を分離するパターンがある。
- UI は Tailwind CSS + Radix UI + `cn` ユーティリティを使う。
- テストは Vitest。`tests/api` は route 契約寄り、`tests/lib` や直下テストは共通ロジック寄り。
- セキュリティ: 秘密情報をハードコードしない。Basic auth 用 env は `BASIC_AUTH_USERNAME` と `BASIC_AUTH_PASSWORD` の両方が必要。