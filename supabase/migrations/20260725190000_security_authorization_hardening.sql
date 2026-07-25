-- Security audit hardening.
-- Each checkpoint below closes a verified authorization or tenant-isolation gap.

-- CHECKPOINT 1: prevent arbitrary self-enrollment / owner escalation.
create or replace function public.can_bootstrap_budget_membership(
  p_budget_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() = p_user_id
    and p_role = 'owner'
    and exists (
      select 1
      from public.budgets b
      where b.id = p_budget_id
        and b.created_by = auth.uid()
    )
    and not exists (
      select 1
      from public.budget_members m
      where m.budget_id = p_budget_id
    );
$$;

revoke all on function public.can_bootstrap_budget_membership(uuid, uuid, text)
  from public, anon;
grant execute on function public.can_bootstrap_budget_membership(uuid, uuid, text)
  to authenticated, service_role;

drop policy if exists "budget_members_insert_admin" on public.budget_members;
drop policy if exists "budget_members_insert_authorized" on public.budget_members;
create policy "budget_members_insert_authorized"
on public.budget_members for insert
with check (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and role <> 'owner'
  )
  or public.can_bootstrap_budget_membership(budget_id, user_id, role)
);
