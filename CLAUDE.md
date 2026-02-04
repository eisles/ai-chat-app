# Claude Code Orchestra

**マルチエージェント協調フレームワーク**

Claude Code が Codex CLI（深い推論）と Gemini CLI（大規模リサーチ）を統合し、各エージェントの強みを活かして開発を加速する。

---

## Why This Exists

| Agent | Strength | Use For |
|-------|----------|---------|
| **Claude Code** | オーケストレーション、ユーザー対話 | 全体統括、タスク管理 |
| **Codex CLI** | 深い推論、設計判断、デバッグ | 設計相談、エラー分析、トレードオフ評価 |
| **Gemini CLI** | 1Mトークン、マルチモーダル、Web検索 | コードベース全体分析、ライブラリ調査、PDF/動画処理 |

**IMPORTANT**: 単体では難しいタスクも、3エージェントの協調で解決できる。

---

## Context Management (CRITICAL)

Claude Code のコンテキストは **200k トークン** だが、ツール定義等で **実質 70-100k** に縮小する。

**YOU MUST** サブエージェント経由で Codex/Gemini を呼び出す（出力が10行以上の場合）。

| 出力サイズ | 方法 | 理由 |
|-----------|------|------|
| 1-2文 | 直接呼び出しOK | オーバーヘッド不要 |
| 10行以上 | **サブエージェント経由** | メインコンテキスト保護 |
| 分析レポート | サブエージェント → ファイル保存 | 詳細は `.claude/docs/` に永続化 |

```
# MUST: サブエージェント経由（大きな出力）
Task(subagent_type="general-purpose", prompt="Codexに設計を相談し、要約を返して")

# OK: 直接呼び出し（小さな出力のみ）
Bash("codex exec ... '1文で答えて'")
```

---

## Quick Reference

### Codex を使う時

- 設計判断（「どう実装？」「どのパターン？」）
- デバッグ（「なぜ動かない？」「エラーの原因は？」）
- 比較検討（「AとBどちらがいい？」）

→ 詳細: `.claude/rules/codex-delegation.md`

### Gemini を使う時

- リサーチ（「調べて」「最新の情報は？」）
- 大規模分析（「コードベース全体を理解して」）
- マルチモーダル（「このPDF/動画を見て」）

→ 詳細: `.claude/rules/gemini-delegation.md`

---

## Workflow

```
/startproject <機能名>
```

1. Gemini がリポジトリ分析（サブエージェント経由）
2. Claude が要件ヒアリング・計画作成
3. Codex が計画レビュー（サブエージェント経由）
4. Claude がタスクリスト作成
5. **別セッションで実装後レビュー**（推奨）

→ 詳細: `/startproject`, `/plan`, `/tdd` skills

---

## Tech Stack

- **Python** / **uv** (pip禁止)
- **ruff** (lint/format) / **ty** (type check) / **pytest**
- `poe lint` / `poe test` / `poe all`

→ 詳細: `.claude/rules/dev-environment.md`

---

## Documentation

| Location | Content |
|----------|---------|
| `.claude/rules/` | コーディング・セキュリティ・言語ルール |
| `.claude/docs/DESIGN.md` | 設計決定の記録 |
| `.claude/docs/research/` | Gemini調査結果 |
| `.claude/logs/cli-tools.jsonl` | Codex/Gemini入出力ログ |

---

## Language Protocol

| 対象 | 言語 |
|------|------|
| ユーザーとの対話 | 日本語 |
| コミットメッセージ | 日本語 |
| コードコメント | 日本語 |
| 変数名・関数名 | 英語 |
| LLM (Codex/Gemini) への問い合わせ | 英語 |

→ 詳細: `.claude/rules/language.md`

---

# Project-Specific Information

This is a Next.js 16 App Router application for AI-powered search and chat, using React 19 and TypeScript.

## Development Commands

```bash
npm run dev       # Start Next.js dev server (http://localhost:3000)
npm run build     # Build for production
npm run lint      # Run ESLint
npm run test      # Run Vitest in watch mode
npm run test:run  # Run Vitest once (CI mode)
```

## Architecture Overview

The app integrates multiple AI providers (Vercel AI Gateway, OpenAI, Gemini) with vector search via Neon PostgreSQL + pgvector.

### Core Data Flows

**Image Search** (`/image-search` → `/api/image-search`):
1. Upload image → extract embedding via Vectorize API
2. Generate caption via OpenAI gpt-4o vision
3. Combined search: text embeddings (60% weight) + image embeddings (40% weight)
4. Return ranked results by similarity score

**Text Registration** (`/text-registration` → `/api/texts`):
1. Accept text + metadata + productId + cityCode
2. SHA256 hash for duplicate detection
3. Generate 1536-dim embedding via OpenAI text-embedding-3-small
4. Store in `product_text_embeddings` table

**AI Chat** (`/` → `/api/chat`):
1. Stream messages via Vercel AI SDK `useChat` hook
2. Backend calls AI Gateway with `streamText()`
3. Model configurable via query param (default: gpt-4o-mini)

### Directory Structure

- `/app/[feature]/page.tsx` - UI pages (thin wrappers)
- `/app/api/[feature]/route.ts` - API handlers (validation + library calls)
- `/lib/` - Core business logic (DB, AI calls, embeddings)
- `/components/ui/` - Radix UI + Tailwind primitives
- `/components/ai-elements/` - Feature-specific components (chat, messages)
- `/tests/api/` - Vitest integration tests

### Key Libraries

- `@ai-sdk/*` + `ai` - Vercel AI SDK for chat streaming
- `@neondatabase/serverless` - Postgres HTTP client
- `@xenova/transformers` - Local CLIP for image embeddings
- Radix UI + Tailwind CSS + class-variance-authority - UI components

## Database

Neon PostgreSQL with pgvector extension. Primary table: `product_text_embeddings` with 1536-dim vector column.

Vector search uses `<=>` (cosine distance) operator. Similarity = `1 - distance`.

## Environment Variables

Required in `.env.local`:
```
DATABASE_URL              # Neon Postgres connection string
AI_GATEWAY_API_KEY        # Vercel AI Gateway auth
AI_GATEWAY_URL            # Vercel AI Gateway endpoint
OPENAI_API_KEY            # OpenAI API
GOOGLE_GENERATIVE_AI_API_KEY  # Gemini API (optional)
```

Test DB connection at `/api/db-test`.

## Code Conventions

- **Files**: kebab-case (`image-search.ts`)
- **Components**: PascalCase (`TextInfoTable`)
- **Functions**: camelCase (`buildProductEmbeddingText`)
- **Imports**: Use `@/` alias for repository root
- **UI utilities**: Use `cn()` for Tailwind class merging

TypeScript strict mode is enabled. API inputs/outputs should have explicit type definitions.

## 3-Way Hybrid Search (2026-02-04)

### Problem Solved
- "お肉" search was returning unrelated items like "鰻" (eel) and "シャインマスカット" (grapes)

### Solution: 3-Way RRF Hybrid Search

```
User Query → Keyword Extraction (LLM) → Query Type Detection
                    ↓                         ↓
        ┌───────────┴───────────┬─────────────┴─────────────┐
        ↓                       ↓                           ↓
   Dense Search           Sparse Search              Keyword Search
   (pgvector)             (pg_trgm)                  (ILIKE)
        ↓                       ↓                           ↓
        └───────────────────────┴───────────────────────────┘
                                ↓
                    RRF Score Fusion (k=40-80)
                    score = Σ weight_i / (k + rank_i)
                                ↓
                    Category Boosting
                    (+0.15 match / -0.1 mismatch)
                                ↓
                    Optional: Cohere Rerank
                                ↓
                            Final Results
```

### Dynamic Weights by Query Type

| Query Type | Dense | Sparse | Keyword | RRF K |
|------------|-------|--------|---------|-------|
| keyword (short, ≤4 chars) | 0.20 | 0.50 | 0.30 | 40 |
| keyword (normal) | 0.30 | 0.40 | 0.30 | 40 |
| conceptual | 0.55 | 0.25 | 0.20 | 80 |
| mixed | 0.40 | 0.35 | 0.25 | 60 |

### Core Files
- `lib/hybrid-search.ts` - 3-Way RRF integration (main entry)
- `lib/sparse-search.ts` - pg_trgm-based text similarity
- `lib/query-analyzer.ts` - Query type detection & dynamic weights
- `lib/keyword-search.ts` - ILIKE keyword matching
- `lib/category-utils.ts` - Category inference and boosting
- `lib/reranker.ts` - Cohere Rerank integration (optional)

### API Parameters (`/api/chat-recommend`)
```typescript
{
  history: string;              // User query
  use3WayHybrid?: boolean;      // Enable 3-Way RRF (default: false)
  useSparseSearch?: boolean;    // pg_trgm search (default: true with 3-Way)
  useKeywordSearch?: boolean;   // ILIKE search (default: true)
  useCategoryBoost?: boolean;   // Category boosting (default: true)
  useReranker?: boolean;        // Cohere rerank (default: false)
}
```

### Environment Variables (Optional)
```
COHERE_API_KEY  # For reranking
```

### DB Migrations Required
1. `migrations/001_add_vector_indexes.sql` - HNSW vector index
2. `migrations/002_add_sparse_search_support.sql` - **CRITICAL**
   - Adds `search_text` column (name + categories + description)
   - Creates GIN index for pg_trgm on search_text
   - Creates `category_keywords` table

### Documentation
- Full plan: `.claude/docs/HYBRID_SEARCH_IMPLEMENTATION_PLAN.md`
