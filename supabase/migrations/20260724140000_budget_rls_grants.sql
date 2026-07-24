-- Fix logged-in 500s: grant EXECUTE on RLS helpers + allow members to read their own rows.
-- Without EXECUTE (Postgres 15+ default), is_budget_member/has_budget_role fail inside policies.

grant execute on function public.is_budget_member(uuid) to authenticated, service_role;
grant execute on function public.budget_role(uuid) to authenticated, service_role;
grant execute on function public.has_budget_role(uuid, text) to authenticated, service_role;
grant execute on function public.accept_budget_invite(text) to authenticated, service_role;

-- Own membership rows must be readable even before other budget checks succeed.
drop policy if exists "budget_members_select" on public.budget_members;
create policy "budget_members_select" on public.budget_members for select
  using (
    auth.uid() = user_id
    or public.is_budget_member(budget_id)
  );

-- Ensure authenticated can use the budget tables (Supabase usually has this; idempotent).
grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.budget_members to authenticated;
grant select, insert, update, delete on public.budget_invites to authenticated;

-- Bootstrap budgets for users who have a profile but no membership yet
-- (signed up before multi-budget migration; backfill only covered users with money rows).
insert into public.budgets (name, created_by)
select 'My budget', p.id
from public.profiles p
where not exists (
  select 1 from public.budget_members m where m.user_id = p.id
)
on conflict do nothing;

-- The insert above may create multiple budgets if run twice without memberships;
-- attach owner membership for any budget the user created that lacks a membership row.
insert into public.budget_members (budget_id, user_id, role)
select b.id, b.created_by, 'owner'
from public.budgets b
where not exists (
  select 1 from public.budget_members m
  where m.budget_id = b.id and m.user_id = b.created_by
)
on conflict (budget_id, user_id) do nothing;

update public.profiles p
set current_budget_id = m.budget_id
from public.budget_members m
where m.user_id = p.id
  and m.role = 'owner'
  and p.current_budget_id is null;
