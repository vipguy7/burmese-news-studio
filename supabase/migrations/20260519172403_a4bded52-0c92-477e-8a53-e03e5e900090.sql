
create table public.ai_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start date not null default date_trunc('month', now())::date,
  used_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_usage enable row level security;

create policy "Users can read their own usage"
  on public.ai_usage for select
  to authenticated
  using (auth.uid() = user_id);
