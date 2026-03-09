create table if not exists public.maintenance_action_logs (
  id uuid primary key,
  target text not null,
  action text not null,
  status text not null,
  message text null,
  error text null,
  duration_ms integer null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_maintenance_action_logs_target_created_at
  on public.maintenance_action_logs (target, created_at desc);

create index if not exists idx_maintenance_action_logs_status_created_at
  on public.maintenance_action_logs (status, created_at desc);
