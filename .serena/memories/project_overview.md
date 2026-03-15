# Project Overview
- Purpose: Next.js 16 / React 19 ベースの AI 検証アプリ。チャット、対話型レコメンド、画像埋め込み、画像類似検索、テキスト登録、運用メンテナンスを同一アプリで試せる。
- Architecture: App Router で UI と API を同居。`app/api/*` から `lib/*` の共通ロジックを呼び出し、Neon(Postgres + pgvector) と外部 AI サービスに接続する。
- Main capabilities: AI Gateway チャット、recommend assistant、chat-recommend の hybrid search、画像ベクトル検索、product JSON import、vector maintenance。
- Tech stack: TypeScript strict, Next.js 16, React 19, Tailwind CSS 4, Radix UI, Vercel AI SDK, Neon serverless, pgvector, Vitest.
- Structure: UI pages は `app/`、API routes は `app/api/`、共通 UI は `components/ui/`、業務ロジックは `lib/`、DB 変更は `migrations/`、テストは `tests/`。
- Notes: `proxy.ts` で Basic auth style 保護を提供。検索は dense/sparse/keyword の hybrid を許容し、一部 API は NDJSON 進捗ストリーミングを返す。