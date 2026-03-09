alter table public.maintenance_action_logs
  add column if not exists actor text null;

alter table public.maintenance_action_logs
  add column if not exists request_source text null;
