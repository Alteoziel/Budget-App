-- Ensure sort_order exists, then provide a reliable reorder RPC for accounts.

alter table public.accounts
  add column if not exists sort_order int not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by budget_id
      order by sort_order asc, name asc, id asc
    ) - 1 as next_order
  from public.accounts
)
update public.accounts a
set sort_order = ranked.next_order
from ranked
where a.id = ranked.id
  and a.sort_order is distinct from ranked.next_order;

create or replace function public.reorder_budget_accounts(
  p_budget_id uuid,
  p_account_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  n int;
  owned int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_budget_role(p_budget_id, 'editor') then
    raise exception 'Not allowed';
  end if;

  n := coalesce(array_length(p_account_ids, 1), 0);
  if n = 0 then
    raise exception 'No accounts to reorder';
  end if;

  select count(*)::int into owned
  from public.accounts
  where budget_id = p_budget_id;

  if owned <> n then
    raise exception 'Account list mismatch';
  end if;

  select count(*)::int into owned
  from public.accounts
  where budget_id = p_budget_id
    and id = any (p_account_ids);

  if owned <> n then
    raise exception 'Invalid account ids';
  end if;

  -- Two-phase update avoids unique collisions if a unique index is added later.
  for i in 1..n loop
    update public.accounts
    set sort_order = -i
    where budget_id = p_budget_id
      and id = p_account_ids[i];
  end loop;

  for i in 1..n loop
    update public.accounts
    set sort_order = i - 1
    where budget_id = p_budget_id
      and id = p_account_ids[i];
  end loop;

  return true;
end;
$$;

grant execute on function public.reorder_budget_accounts(uuid, uuid[])
  to authenticated, service_role;
