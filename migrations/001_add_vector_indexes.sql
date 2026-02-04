-- Migration: Add vector and text search indexes
-- Date: 2026-02-04
-- Purpose: Optimize vector search for 70万+ items

-- =====================================================
-- IMPORTANT: Run these commands manually on your database
-- =====================================================

-- 0. pg_trgm 拡張を有効化（similarity() 関数とtrigramインデックスに必要）
-- Neonでは標準で利用可能
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Vector index for similarity search (CRITICAL for performance)
-- HNSW (Hierarchical Navigable Small World) provides fast approximate nearest neighbor search
-- Parameters: m=16 (connections per node), ef_construction=64 (build-time quality)
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_embedding_hnsw_idx
  ON product_text_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 2. GIN index for category JSONB queries
-- Enables fast filtering by category in metadata
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_categories_gin_idx
  ON product_text_embeddings
  USING gin ((metadata->'raw'->'categories'));

-- 3. Text search index for keyword matching (pg_trgm)
-- similarity() 関数でのスコアリングとILIKE検索の高速化
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_text_trgm_idx
  ON product_text_embeddings
  USING gin (text gin_trgm_ops);

-- 4. Composite index for filtered searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_amount_idx
  ON product_text_embeddings (amount)
  WHERE amount IS NOT NULL;

-- =====================================================
-- Verification queries
-- =====================================================

-- Check if pg_trgm is enabled:
-- SELECT * FROM pg_extension WHERE extname = 'pg_trgm';

-- Check if indexes were created:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'product_text_embeddings';

-- Check index sizes:
-- SELECT pg_size_pretty(pg_relation_size('product_text_embeddings_embedding_hnsw_idx'));

-- Test similarity function:
-- SELECT similarity('お肉', '黒毛和牛ステーキセット');
