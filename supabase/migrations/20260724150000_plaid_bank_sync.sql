-- Plaid bank sync: items, account maps; reuse transactions.external_id + sync_runs.

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  item_id text not null,
  institution_id text,
  institution_name text not null default '',
  status text not null default 'active'
    check (status in ('active', 'disconnected', 'error')),
  access_token_encrypted text not null,
  sync_cursor text,
  created_by uuid not null references auth.users (id) on delete cascade,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, item_id)
);

create table if not exists public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  plaid_item_id uuid not null references public.plaid_items (id) on delete cascade,
  plaid_account_id text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (budget_id, plaid_account_id),
  unique (account_id)
);

-- Ensure external_id exists even if teller migration was skipped.
alter table public.transactions
  add column if not exists external_id text;

create unique index if not exists transactions_budget_external_id_uidx
  on public.transactions (budget_id, external_id)
  where external_id is not null;

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid references public.budgets (id) on delete cascade,
  enrollment_id uuid,
  plaid_item_id uuid references public.plaid_items (id) on delete set null,
  source text not null default 'plaid',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  inserted int not null default 0,
  updated int not null default 0,
  errors text,
  created_at timestamptz not null default now()
);

alter table public.sync_runs
  add column if not exists plaid_item_id uuid references public.plaid_items (id) on delete set null;

alter table public.sync_runs drop constraint if exists sync_runs_source_check;
alter table public.sync_runs
  add constraint sync_runs_source_check
  check (source in ('teller', 'plaid', 'cron', 'manual'));

create index if not exists idx_plaid_items_budget on public.plaid_items (budget_id);
create index if not exists idx_plaid_accounts_item on public.plaid_accounts (plaid_item_id);
create index if not exists idx_sync_runs_budget_started on public.sync_runs (budget_id, started_at desc);

alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "plaid_items_select" on public.plaid_items;
create policy "plaid_items_select" on public.plaid_items
  for select using (public.is_budget_member(budget_id));

drop policy if exists "plaid_items_write" on public.plaid_items;
create policy "plaid_items_write" on public.plaid_items
  for all using (public.has_budget_role(budget_id, 'admin'))
  with check (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "plaid_accounts_select" on public.plaid_accounts;
create policy "plaid_accounts_select" on public.plaid_accounts
  for select using (public.is_budget_member(budget_id));

drop policy if exists "plaid_accounts_write" on public.plaid_accounts;
create policy "plaid_accounts_write" on public.plaid_accounts
  for all using (public.has_budget_role(budget_id, 'admin'))
  with check (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "sync_runs_select" on public.sync_runs;
create policy "sync_runs_select" on public.sync_runs
  for select using (budget_id is null or public.is_budget_member(budget_id));

drop policy if exists "sync_runs_write" on public.sync_runs;
create policy "sync_runs_write" on public.sync_runs
  for all using (budget_id is null or public.has_budget_role(budget_id, 'admin'))
  with check (budget_id is null or public.has_budget_role(budget_id, 'admin'));

grant select, insert, update, delete on public.plaid_items to authenticated;
grant select, insert, update, delete on public.plaid_accounts to authenticated;
grant select, insert, update, delete on public.sync_runs to authenticated;
