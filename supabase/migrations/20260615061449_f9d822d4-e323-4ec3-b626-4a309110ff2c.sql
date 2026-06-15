
drop policy if exists "Authenticated can update brain items" on public.brain_items;
drop policy if exists "Authenticated can delete brain items" on public.brain_items;

create policy "Creators can update their brain items"
  on public.brain_items for update to authenticated
  using (auth.uid() = created_by) with check (auth.uid() = created_by);

create policy "Creators can delete their brain items"
  on public.brain_items for delete to authenticated
  using (auth.uid() = created_by);

revoke execute on function public.match_brain_items(vector, int) from public, anon;
grant execute on function public.match_brain_items(vector, int) to service_role;
