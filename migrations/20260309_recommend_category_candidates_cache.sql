create table if not exists public.recommend_category_candidates_cache (
  name text primary key,
  count integer not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists idx_recommend_category_candidates_cache_count
  on public.recommend_category_candidates_cache (count desc, name asc);
