create table if not exists public.product_import_vectorize_tail_items (
  id uuid primary key,
  job_id uuid not null references public.product_import_jobs_v2(id) on delete cascade,
  import_item_id uuid not null references public.product_import_items_v2(id) on delete cascade,
  product_id text not null,
  city_code text,
  image_url text not null,
  slide_index integer not null,
  status text not null default 'pending',
  error text,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  error_code text,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_import_vectorize_tail_items_unique_item_slide'
  ) then
    alter table public.product_import_vectorize_tail_items
    add constraint product_import_vectorize_tail_items_unique_item_slide
    unique (import_item_id, slide_index);
  end if;
end
$$;

create index if not exists product_import_vectorize_tail_items_job_status_idx
  on public.product_import_vectorize_tail_items(job_id, status, next_retry_at, slide_index);

create index if not exists product_import_vectorize_tail_items_product_status_idx
  on public.product_import_vectorize_tail_items(product_id, status, slide_index);
