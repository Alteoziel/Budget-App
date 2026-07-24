-- Manual balance anchors use transactions.external_id = 'balance-anchor:<account_id>'.
-- Bank↔manual match suggestions for approve/deny after sync.

create table if not exists public.transaction_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  manual_transaction_id uuid not null references public.transactions (id) on delete cascade,
  bank_transaction_id uuid not null references public.transactions (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  amount_diff_cents int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (manual_transaction_id, bank_transaction_id),
  check (manual_transaction_id <> bank_transaction_id)
);

create unique index if not exists transaction_match_suggestions_pending_manual_uidx
  on public.transaction_match_suggestions (manual_transaction_id)
  where status = 'pending';

create unique index if not exists transaction_match_suggestions_pending_bank_uidx
  on public.transaction_match_suggestions (bank_transaction_id)
  where status = 'pending';

create index if not exists idx_transaction_match_suggestions_account_status
  on public.transaction_match_suggestions (account_id, status);

create index if not exists idx_transaction_match_suggestions_budget_status
  on public.transaction_match_suggestions (budget_id, status);

alter table public.transaction_match_suggestions enable row level security;

drop policy if exists "transaction_match_suggestions_select" on public.transaction_match_suggestions;
create policy "transaction_match_suggestions_select" on public.transaction_match_suggestions
  for select using (public.is_budget_member(budget_id));

drop policy if exists "transaction_match_suggestions_write" on public.transaction_match_suggestions;
create policy "transaction_match_suggestions_write" on public.transaction_match_suggestions
  for all using (public.has_budget_role(budget_id, 'editor'))
  with check (public.has_budget_role(budget_id, 'editor'));

grant select, insert, update, delete on public.transaction_match_suggestions to authenticated;
