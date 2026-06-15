
create extension if not exists vector;

create table public.brain_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  title text not null,
  content text not null,
  source_url text,
  source_type text not null default 'text',
  language text not null default 'unknown',
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.brain_items to authenticated;
grant all on public.brain_items to service_role;

alter table public.brain_items enable row level security;

create policy "Authenticated can read brain items"
  on public.brain_items for select to authenticated using (true);

create policy "Authenticated can insert brain items"
  on public.brain_items for insert to authenticated with check (auth.uid() = created_by);

create policy "Authenticated can update brain items"
  on public.brain_items for update to authenticated using (true) with check (true);

create policy "Authenticated can delete brain items"
  on public.brain_items for delete to authenticated using (true);

create index brain_items_embedding_idx on public.brain_items
  using hnsw (embedding vector_cosine_ops);
create index brain_items_created_at_idx on public.brain_items (created_at desc);

create or replace function public.match_brain_items(
  query_embedding vector(1536),
  match_count int default 6
) returns table (
  id uuid,
  title text,
  content text,
  source_url text,
  language text,
  tags text[],
  similarity float
)
language sql stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.content, b.source_url, b.language, b.tags,
         1 - (b.embedding <=> query_embedding) as similarity
  from public.brain_items b
  where b.embedding is not null
  order by b.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.update_updated_at_column()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql set search_path = public;

create trigger brain_items_updated_at
  before update on public.brain_items
  for each row execute function public.update_updated_at_column();
