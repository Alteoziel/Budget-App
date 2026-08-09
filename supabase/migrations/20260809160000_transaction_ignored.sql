-- Per-transaction ignore flag for insights. Rows stay in accounts/registers
-- and still count toward balances; only insights skip them.

alter table public.transactions
  add column if not exists ignored boolean not null default false;

comment on column public.transactions.ignored is
  'When true, this transaction is excluded from insights. Account balances and registers still include it.';

create index if not exists transactions_budget_ignored_idx
  on public.transactions (budget_id, ignored)
  where ignored = false;
