-- Migration: Add sparse search support for hybrid search
-- Date: 2026-02-04
-- Purpose: Enable 3-Way RRF Hybrid Search (Dense + Sparse + Keyword)
-- Note: pg_bigm is NOT available on Neon, using pg_trgm with optimizations

-- =====================================================
-- IMPORTANT: Run these commands manually on your database
-- =====================================================

-- Prerequisites: pg_trgm should already be enabled from 001_add_vector_indexes.sql
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- Step 1: Add search_text column for optimized text search
-- =====================================================

-- Add normalized search text column (combines name, categories, description)
ALTER TABLE product_text_embeddings
ADD COLUMN IF NOT EXISTS search_text TEXT;

-- =====================================================
-- Step 2: Populate search_text from existing data
-- =====================================================

-- Extract searchable text from metadata (name + categories + description + catchphrase)
UPDATE product_text_embeddings
SET search_text = COALESCE(
  -- Product name from metadata
  metadata->'raw'->>'name',
  ''
) || ' ' || COALESCE(
  -- Categories concatenated
  (
    SELECT string_agg(
      COALESCE(cat->>'category1_name', '') || ' ' ||
      COALESCE(cat->>'category2_name', '') || ' ' ||
      COALESCE(cat->>'category3_name', ''),
      ' '
    )
    FROM jsonb_array_elements(metadata->'raw'->'categories') AS cat
  ),
  ''
) || ' ' || COALESCE(
  -- Description (first 500 chars for performance)
  LEFT(metadata->'raw'->>'description', 500),
  ''
) || ' ' || COALESCE(
  -- Catchphrase
  metadata->'raw'->>'catchphrase',
  ''
)
WHERE search_text IS NULL;

-- Fallback: use main text if search_text is still empty
UPDATE product_text_embeddings
SET search_text = text
WHERE search_text IS NULL OR TRIM(search_text) = '';

-- =====================================================
-- Step 3: Create optimized GIN index for search_text
-- =====================================================

-- GIN index for pg_trgm on search_text (optimized for Japanese queries)
-- This enables fast similarity() calculations and ILIKE/% operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_search_text_trgm
  ON product_text_embeddings
  USING gin (search_text gin_trgm_ops);

-- =====================================================
-- Step 4: Set pg_trgm configuration for better Japanese support
-- =====================================================

-- Lower similarity threshold for short Japanese queries (default is 0.3)
-- This helps with 2-3 character queries like "お肉"
-- Note: This is a session-level setting, consider setting in application code
-- SET pg_trgm.similarity_threshold = 0.1;

-- =====================================================
-- Step 5: Create helper function for sparse search scoring
-- =====================================================

-- Function to calculate combined sparse score from multiple keywords
CREATE OR REPLACE FUNCTION calculate_sparse_score(
  search_text TEXT,
  keywords TEXT[]
)
RETURNS FLOAT AS $$
DECLARE
  total_score FLOAT := 0;
  kw TEXT;
BEGIN
  IF keywords IS NULL OR array_length(keywords, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH kw IN ARRAY keywords
  LOOP
    -- Use pg_trgm similarity
    total_score := total_score + similarity(search_text, kw);
  END LOOP;

  -- Return average score
  RETURN total_score / array_length(keywords, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- Step 6: Create materialized view for category statistics (optional, for category boosting)
-- =====================================================

-- Category keyword mapping for boosting
-- This helps identify when query matches product category
CREATE TABLE IF NOT EXISTS category_keywords (
  category_name TEXT PRIMARY KEY,
  keywords TEXT[] NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert common category keywords for Japanese furusato nozei products
INSERT INTO category_keywords (category_name, keywords) VALUES
  ('肉', ARRAY['肉', 'お肉', '牛肉', '豚肉', '鶏肉', '和牛', 'ステーキ', '焼肉', 'しゃぶしゃぶ', 'すき焼き', 'ハンバーグ', 'ソーセージ', 'ベーコン', 'ハム']),
  ('魚介', ARRAY['魚', '魚介', '海鮮', '刺身', '寿司', '鮭', 'サーモン', 'まぐろ', 'マグロ', 'いくら', 'うに', 'ウニ', 'かに', 'カニ', '蟹', 'えび', 'エビ', '海老', 'ほたて', 'ホタテ', '帆立']),
  ('米', ARRAY['米', 'お米', 'コメ', 'こめ', '新米', '精米', '玄米', 'ご飯', 'ごはん', 'コシヒカリ', 'あきたこまち', 'ひとめぼれ', 'ゆめぴりか']),
  ('果物', ARRAY['果物', 'フルーツ', 'くだもの', 'りんご', 'リンゴ', '林檎', 'みかん', 'ミカン', '蜜柑', 'ぶどう', 'ブドウ', '葡萄', 'シャインマスカット', 'もも', 'モモ', '桃', 'いちご', 'イチゴ', '苺', 'メロン', 'さくらんぼ', 'マンゴー']),
  ('野菜', ARRAY['野菜', 'やさい', 'トマト', 'きゅうり', 'なす', 'ナス', 'ピーマン', 'じゃがいも', 'たまねぎ', '玉ねぎ', 'にんじん', '人参', 'キャベツ', 'レタス', 'ほうれん草', 'アスパラ', 'とうもろこし']),
  ('酒', ARRAY['酒', 'お酒', '日本酒', '焼酎', 'ビール', 'ワイン', '地酒', '純米', '大吟醸', '芋焼酎', '麦焼酎']),
  ('スイーツ', ARRAY['スイーツ', 'お菓子', 'ケーキ', 'チョコ', 'チョコレート', 'アイス', 'アイスクリーム', 'プリン', 'ゼリー', 'クッキー', '饅頭', 'まんじゅう', '羊羹', 'ようかん', '和菓子', '洋菓子'])
ON CONFLICT (category_name) DO NOTHING;

-- =====================================================
-- Verification queries
-- =====================================================

-- Check search_text column was populated:
-- SELECT COUNT(*) as total, COUNT(search_text) as with_search_text FROM product_text_embeddings;

-- Check index was created:
-- SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_product_search_text_trgm';

-- Test similarity function with short query:
-- SELECT similarity('お肉', search_text) as score, LEFT(search_text, 100) as text_preview
-- FROM product_text_embeddings
-- WHERE search_text ILIKE '%肉%'
-- ORDER BY score DESC
-- LIMIT 10;

-- Test calculate_sparse_score function:
-- SELECT calculate_sparse_score(search_text, ARRAY['お肉', '和牛']) as score, LEFT(search_text, 100)
-- FROM product_text_embeddings
-- WHERE search_text ILIKE '%肉%'
-- ORDER BY score DESC
-- LIMIT 10;
