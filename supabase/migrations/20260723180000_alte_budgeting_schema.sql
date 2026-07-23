-- Alte' Budgeting schema + RLS
-- Run in Supabase SQL editor or via supabase db push

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  account_type text not null default 'checking'
    check (account_type in ('checking', 'savings', 'credit', 'cash', 'other')),
  currency char(3) not null default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.category_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.category_groups (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, group_id, name)
);

create table if not exists public.budget_months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month char(7) not null check (month ~ '^\d{4}-\d{2}$'),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

create table if not exists public.category_months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  month char(7) not null check (month ~ '^\d{4}-\d{2}$'),
  assigned_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  occurred_on date not null,
  payee text not null default '',
  memo text not null default '',
  amount_cents bigint not null,
  cleared boolean not null default true,
  import_batch_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  filename text not null,
  source text not null default 'ynab_csv',
  inserted_count int not null default 0,
  skipped_count int not null default 0,
  error_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.transactions
  drop constraint if exists transactions_import_batch_id_fkey;
alter table public.transactions
  add constraint transactions_import_batch_id_fkey
  foreign key (import_batch_id) references public.import_batches (id) on delete set null;

create index if not exists idx_accounts_user on public.accounts (user_id);
create index if not exists idx_categories_user on public.categories (user_id);
create index if not exists idx_transactions_user_date on public.transactions (user_id, occurred_on desc);
create index if not exists idx_transactions_account_date on public.transactions (account_id, occurred_on desc);
create index if not exists idx_transactions_category on public.transactions (category_id);
create index if not exists idx_category_months_user_month on public.category_months (user_id, month);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.category_groups enable row level security;
alter table public.categories enable row level security;
alter table public.budget_months enable row level security;
alter table public.category_months enable row level security;
alter table public.transactions enable row level security;
alter table public.import_batches enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

create policy "accounts_all_own" on public.accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "category_groups_all_own" on public.category_groups for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "categories_all_own" on public.categories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "budget_months_all_own" on public.budget_months for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "category_months_all_own" on public.category_months for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "transactions_all_own" on public.transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "import_batches_all_own" on public.import_batches for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
