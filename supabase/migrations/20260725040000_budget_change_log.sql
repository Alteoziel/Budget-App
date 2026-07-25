-- 7-day undo / recent changes log for deletes and edits.
-- Entries expire after 7 days and are purged on read or via cleanup RPC.

create table if not exists public.budget_change_log (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null
    check (entity_type in ('transaction', 'account', 'category', 'category_group')),
  entity_id uuid,
  action text not null check (action in ('delete', 'update')),
  summary text not null default '',
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  restored_at timestamptz
);

create index if not exists idx_budget_change_log_budget_created
  on public.budget_change_log (budget_id, created_at desc);

create index if not exists idx_budget_change_log_expires
  on public.budget_change_log (expires_at)
  where restored_at is null;

alter table public.budget_change_log enable row level security;

drop policy if exists "budget_change_log_select_member" on public.budget_change_log;
create policy "budget_change_log_select_member" on public.budget_change_log
  for select using (public.is_budget_member(budget_id));

drop policy if exists "budget_change_log_insert_editor" on public.budget_change_log;
create policy "budget_change_log_insert_editor" on public.budget_change_log
  for insert with check (
    public.has_budget_role(budget_id, 'editor')
    and auth.uid() = actor_user_id
  );

drop policy if exists "budget_change_log_update_editor" on public.budget_change_log;
create policy "budget_change_log_update_editor" on public.budget_change_log
  for update using (public.has_budget_role(budget_id, 'editor'));

drop policy if exists "budget_change_log_delete_editor" on public.budget_change_log;
create policy "budget_change_log_delete_editor" on public.budget_change_log
  for delete using (public.has_budget_role(budget_id, 'editor'));

grant select, insert, update, delete on public.budget_change_log to authenticated;

create or replace function public.purge_expired_budget_change_log(p_budget_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if p_budget_id is null then
    delete from public.budget_change_log
    where expires_at < now();
  else
    if not public.is_budget_member(p_budget_id) then
      raise exception 'Not a budget member';
    end if;
    delete from public.budget_change_log
    where budget_id = p_budget_id
      and expires_at < now();
  end if;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.purge_expired_budget_change_log(uuid) to authenticated, service_role;

comment on table public.budget_change_log is
  'Soft history of deletes/updates for undo within 7 days; older rows are permanently purged.';
