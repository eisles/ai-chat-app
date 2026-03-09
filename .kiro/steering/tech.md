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
- pgvector / pg_trgm / tsvector を組み合わせた検索基盤と、必要に応じた再ランキング
- Vitest による API テスト
- SQL マイグレーション（`/migrations/*.sql`）によるスキーマ変更管理

## Development Standards

### Type Safety
TypeScript strict を前提とし、API 入出力は明示的に型定義する。

### Code Quality
ESLint で整形・静的解析を実施する。UI コンポーネントは共通ユーティリティ (`cn`) を通す。

### Testing
Vitest を使った API ルートの統合テストを実装する。

### API Layering
Route Handler は薄く保ち、機能ロジックは `lib/*` の engine / service / repository に分離する。

### Search Pipeline
検索は単一方式に固定せず、dense vector・sparse text・keyword を組み合わせる。ランキング調整やフォールバックは `lib/` の検索モジュール側で吸収し、UI や route には検索戦略の切り替えだけを残す。

### Search Performance Guardrails
検索ホットパスでは index 前提のクエリを維持し、必要に応じて短寿命の query embedding cache で同一クエリの埋め込み再生成を抑える。性能回復が必要な場合は SQL migration と maintenance API の両方で ANN index や統計情報を修復できるようにする。

### Progress Streaming
待ち時間が長い会話 API では、通常の JSON 応答に加えて NDJSON ベースの進捗イベントを返せるようにし、UI は実際の処理段階を表示する。

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
- 検索品質検証では dense / sparse / keyword のハイブリッド検索を許容し、必要に応じて再ランキングを後段で重ねる
- 推薦系は `app/api/recommend/*` と `lib/recommend*` で責務分離し、会話進行・検索・個人化をモジュール化する
- 検索性能の回復手段はアプリ内に持ち、`product_images_vectorize` と `product_text_embeddings` の index / analyze / 補助 index 修復を maintenance API と migration の両面で扱う
- 調査や運用向けの長時間処理は、完了待ち一発ではなく進捗イベントやメンテナンス API に分割して扱う
- スキーマ変更は破壊的変更より加算型マイグレーションを優先し、運用時の互換性を維持する
- プレビュー/検証環境の保護は `proxy.ts` で行い、環境変数が片方だけ設定された場合は 500 で fail-closed にする

---
_Document standards and patterns, not every dependency_

## 更新履歴
- updated_at: 2026-03-09
- 変更理由: ハイブリッド検索、query embedding cache、テキスト/画像埋め込みの maintenance パターンを含む技術パターンを追加
