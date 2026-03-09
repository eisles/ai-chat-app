-- Migration: Add indexes for product image vector similarity search
-- Date: 2026-03-09
-- Purpose: Accelerate ANN search and avoid repeated image vectorization work

-- =====================================================
-- IMPORTANT: Run these commands manually on your database
-- - CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- =====================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. ANN index for nearest-neighbor search on product_images_vectorize.embedding
-- Current search query uses the L2 operator `<->`, so keep vector_l2_ops for compatibility.
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_images_vectorize_embedding_hnsw_idx
  ON public.product_images_vectorize
  USING hnsw (embedding vector_l2_ops)
  WITH (m = 16, ef_construction = 64);

-- 2. Remove historical duplicates before adding the unique key.
-- Keep the most recently updated row for each (product_id, slide_index).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY product_id, slide_index
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM public.product_images_vectorize
)
DELETE FROM public.product_images_vectorize
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE row_num > 1
);

-- 3. Unique key for product + slide upsert path
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS product_images_vectorize_product_slide_uidx
  ON public.product_images_vectorize (product_id, slide_index);

-- 4. Reuse stored embedding when the same image URL is already known
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_images_vectorize_image_url_idx
  ON public.product_images_vectorize (image_url)
  WHERE image_url IS NOT NULL;

-- 5. Speed up "latest product_json row per product" lateral join
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_text_embeddings_product_json_latest_idx
  ON public.product_text_embeddings (product_id, updated_at DESC)
  WHERE text_source = 'product_json';

-- Optional follow-up after index creation:
-- ANALYZE public.product_images_vectorize;
-- ANALYZE public.product_text_embeddings;
