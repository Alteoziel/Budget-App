-- Teller Development bank sync: enrollments, account maps, external_id upserts, sync runs.

alter table public.transactions
  add column if not exists external_id text;

create unique index if not exists transactions_budget_external_id_uidx
  on public.transactions (budget_id, external_id)
  where external_id is not null;

create table if not exists public.teller_enrollments (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  enrollment_id text not null,
  institution_name text not null default '',
  status text not null default 'active'
    check (status in ('active', 'disconnected', 'error')),
  access_token_encrypted text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, enrollment_id)
);

create table if not exists public.teller_accounts (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  enrollment_id uuid not null references public.teller_enrollments (id) on delete cascade,
  teller_account_id text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (budget_id, teller_account_id),
  unique (account_id)
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid references public.budgets (id) on delete cascade,
  enrollment_id uuid references public.teller_enrollments (id) on delete set null,
  source text not null default 'teller' check (source in ('teller', 'cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  inserted int not null default 0,
  updated int not null default 0,
  errors text,
  created_at timestamptz not null default now()
);

create index if not exists idx_teller_enrollments_budget on public.teller_enrollments (budget_id);
create index if not exists idx_teller_accounts_enrollment on public.teller_accounts (enrollment_id);
create index if not exists idx_sync_runs_budget_started on public.sync_runs (budget_id, started_at desc);

alter table public.teller_enrollments enable row level security;
alter table public.teller_accounts enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "teller_enrollments_select" on public.teller_enrollments;
create policy "teller_enrollments_select" on public.teller_enrollments
  for select using (public.is_budget_member(budget_id));

drop policy if exists "teller_enrollments_write" on public.teller_enrollments;
create policy "teller_enrollments_write" on public.teller_enrollments
  for all using (public.has_budget_role(budget_id, 'admin'))
  with check (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "teller_accounts_select" on public.teller_accounts;
create policy "teller_accounts_select" on public.teller_accounts
  for select using (public.is_budget_member(budget_id));

drop policy if exists "teller_accounts_write" on public.teller_accounts;
create policy "teller_accounts_write" on public.teller_accounts
  for all using (public.has_budget_role(budget_id, 'admin'))
  with check (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "sync_runs_select" on public.sync_runs;
create policy "sync_runs_select" on public.sync_runs
  for select using (budget_id is null or public.is_budget_member(budget_id));

drop policy if exists "sync_runs_write" on public.sync_runs;
create policy "sync_runs_write" on public.sync_runs
  for all using (budget_id is null or public.has_budget_role(budget_id, 'admin'))
  with check (budget_id is null or public.has_budget_role(budget_id, 'admin'));
