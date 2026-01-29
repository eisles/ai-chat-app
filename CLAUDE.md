# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev       # Start Next.js dev server (http://localhost:3000)
npm run build     # Build for production
npm run lint      # Run ESLint
npm run test      # Run Vitest in watch mode
npm run test:run  # Run Vitest once (CI mode)
```

## Architecture Overview

This is a Next.js 16 App Router application for AI-powered search and chat, using React 19 and TypeScript. The app integrates multiple AI providers (Vercel AI Gateway, OpenAI, Gemini) with vector search via Neon PostgreSQL + pgvector.

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
