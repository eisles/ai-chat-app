# Technology Stack

## Architecture

Next.js App Router を中心に、UI と API ルートを同一リポジトリで管理する構成。AI 連携や DB 操作は API ルート経由で実行し、UI はクライアントコンポーネントで操作する。

## Core Technologies

- **Language**: TypeScript
- **Framework**: Next.js 16 (App Router)
- **UI Runtime**: React 19
- **Runtime**: Node.js (Next.js Route Handlers)

## Key Libraries

- Vercel AI SDK (`@ai-sdk/*`) と `ai` によるチャット体験
- Neon serverless driver (`@neondatabase/serverless`) による Postgres 接続
- `@xenova/transformers` によるローカル CLIP 画像埋め込み
- OpenAI / Gemini / 外部 Vectorize API を REST で呼び出す埋め込み処理
- Tailwind CSS + Radix UI + class-variance-authority による UI 構成
- Vitest による API テスト

## Development Standards

### Type Safety
TypeScript strict を前提とし、API 入出力は明示的に型定義する。

### Code Quality
ESLint で整形・静的解析を実施する。UI コンポーネントは共通ユーティリティ (`cn`) を通す。

### Testing
Vitest を使った API ルートの統合テストを実装する。

## Development Environment

### Required Tools
- Node.js と npm

### Common Commands
```bash
# Dev: npm run dev
# Build: npm run build
# Test: npm run test:run
# Lint: npm run lint
```

## Key Technical Decisions

- AI Gateway 経由チャットと OpenAI API 呼び出しを共存させ、用途ごとにモデルを切り替える
- ベクトル検索は Postgres + pgvector を採用し、API ルートで同期処理する

---
_Document standards and patterns, not every dependency_

## 更新履歴
- updated_at: 2025-02-14
- 変更理由: 画像埋め込みのプロバイダ構成（ローカル/外部 API）とフレームワークバージョンを反映
