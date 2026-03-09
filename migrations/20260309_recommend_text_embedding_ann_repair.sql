-- Migration: Repair/add ANN index for recommend-assistant text search
-- Date: 2026-03-09
-- Purpose: Ensure product_text_embeddings uses HNSW ANN search in production

-- =====================================================
-- IMPORTANT: Run these commands manually on your database
-- - CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- - If an invalid index with the same name already exists, drop it manually
--   with DROP INDEX CONCURRENTLY before running this migration.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. ANN index for nearest-neighbor search on product_text_embeddings.embedding
-- The current recommend-assistant search uses the cosine-distance operator `<=>`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_embedding_hnsw_idx
  ON public.product_text_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 2. Keep the amount filter index present for budget filtering paths.
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_amount_idx
  ON public.product_text_embeddings (amount)
  WHERE amount IS NOT NULL;

-- 3. Refresh table statistics after index changes.
ANALYZE public.product_text_embeddings;
