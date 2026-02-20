create table if not exists public.recommend_click_events (
  id uuid primary key,
  user_id uuid not null,
  source text not null default 'recommend-assistant',
  product_id text not null,
  city_code text null,
  score double precision null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_recommend_click_events_user_created_at
  on public.recommend_click_events (user_id, created_at desc);

create index if not exists idx_recommend_click_events_product_id
  on public.recommend_click_events (product_id);
