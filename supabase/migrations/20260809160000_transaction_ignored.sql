-- Per-transaction ignore flag. Ignored rows stay in the register for undo,
-- but balances, budget activity, and insights skip them.

alter table public.transactions
  add column if not exists ignored boolean not null default false;

comment on column public.transactions.ignored is
  'When true, this transaction is hidden from account balances, budget activity, and insights.';

create index if not exists transactions_budget_ignored_idx
  on public.transactions (budget_id, ignored)
  where ignored = false;
