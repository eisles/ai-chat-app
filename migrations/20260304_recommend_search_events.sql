create table if not exists public.recommend_search_events (
  id uuid primary key,
  user_id uuid null,
  source text not null default 'recommend-assistant',
  event_type text not null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_recommend_search_events_event_created_at
  on public.recommend_search_events (event_type, created_at desc);

create index if not exists idx_recommend_search_events_user_created_at
  on public.recommend_search_events (user_id, created_at desc);
