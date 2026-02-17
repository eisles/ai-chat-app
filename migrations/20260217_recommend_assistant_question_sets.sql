create extension if not exists pgcrypto;

create table if not exists recommend_assistant_question_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null unique,
  status text not null check (status in ('draft', 'published', 'archived')),
  steps jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists recommend_assistant_one_published_idx
  on recommend_assistant_question_sets ((status))
  where status = 'published';
