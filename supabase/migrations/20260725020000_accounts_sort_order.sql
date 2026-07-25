-- Allow reordering accounts on the Accounts tab.

alter table public.accounts
  add column if not exists sort_order int not null default 0;

-- Backfill stable order per budget (then by name) for existing rows.
with ranked as (
  select
    id,
    row_number() over (
      partition by budget_id
      order by name asc, id asc
    ) - 1 as next_order
  from public.accounts
)
update public.accounts a
set sort_order = ranked.next_order
from ranked
where a.id = ranked.id;
