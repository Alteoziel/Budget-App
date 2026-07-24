-- Multi-budget households: budgets, members, invites, budget-scoped money tables + RLS.

-- ── Core budget tables ──────────────────────────────────────────────
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_members (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (budget_id, user_id)
);

create table if not exists public.budget_invites (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  token_hash text not null unique,
  kind text not null check (kind in ('role', 'shared')),
  role text check (role is null or role in ('owner', 'admin', 'editor', 'viewer')),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz,
  max_uses int,
  uses int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_budget_members_user on public.budget_members (user_id);
create index if not exists idx_budget_members_budget on public.budget_members (budget_id);
create index if not exists idx_budget_invites_budget on public.budget_invites (budget_id);

alter table public.profiles
  add column if not exists current_budget_id uuid references public.budgets (id) on delete set null;

-- ── Add budget_id columns ───────────────────────────────────────────
alter table public.accounts add column if not exists budget_id uuid references public.budgets (id) on delete cascade;
alter table public.category_groups add column if not exists budget_id uuid references public.budgets (id) on delete cascade;
alter table public.categories add column if not exists budget_id uuid references public.budgets (id) on delete cascade;
alter table public.budget_months add column if not exists budget_id uuid references public.budgets (id) on delete cascade;
alter table public.category_months add column if not exists budget_id uuid references public.budgets (id) on delete cascade;
alter table public.transactions add column if not exists budget_id uuid references public.budgets (id) on delete cascade;
alter table public.import_batches add column if not exists budget_id uuid references public.budgets (id) on delete cascade;

-- ── Backfill: one default budget per distinct user_id that owns data ─
do $$
declare
  r record;
  new_budget_id uuid;
begin
  for r in
    select distinct user_id as uid from public.accounts
    union
    select distinct user_id from public.category_groups
    union
    select distinct user_id from public.transactions
    union
    select distinct user_id from public.import_batches
    union
    select distinct user_id from public.budget_months
    union
    select distinct user_id from public.category_months
    union
    select distinct user_id from public.categories
  loop
    insert into public.budgets (name, created_by)
    values ('My budget', r.uid)
    returning id into new_budget_id;

    insert into public.budget_members (budget_id, user_id, role)
    values (new_budget_id, r.uid, 'owner')
    on conflict (budget_id, user_id) do nothing;

    update public.profiles set current_budget_id = new_budget_id where id = r.uid;

    update public.accounts set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
    update public.category_groups set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
    update public.categories set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
    update public.budget_months set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
    update public.category_months set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
    update public.transactions set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
    update public.import_batches set budget_id = new_budget_id where user_id = r.uid and budget_id is null;
  end loop;
end $$;

-- Any leftover orphan rows without budget_id get a budget from their user_id
-- (safety no-op if already filled).

alter table public.accounts alter column budget_id set not null;
alter table public.category_groups alter column budget_id set not null;
alter table public.categories alter column budget_id set not null;
alter table public.budget_months alter column budget_id set not null;
alter table public.category_months alter column budget_id set not null;
alter table public.transactions alter column budget_id set not null;
alter table public.import_batches alter column budget_id set not null;

-- ── Replace uniqueness with budget-scoped indexes ───────────────────
drop index if exists accounts_user_lower_name_uidx;
create unique index if not exists accounts_budget_lower_name_uidx
  on public.accounts (budget_id, lower(name));

drop index if exists category_groups_user_lower_name_uidx;
create unique index if not exists category_groups_budget_lower_name_uidx
  on public.category_groups (budget_id, lower(name));

drop index if exists categories_user_group_lower_name_uidx;
create unique index if not exists categories_budget_group_lower_name_uidx
  on public.categories (budget_id, group_id, lower(name));

alter table public.budget_months drop constraint if exists budget_months_user_id_month_key;
create unique index if not exists budget_months_budget_month_uidx
  on public.budget_months (budget_id, month);

alter table public.category_months drop constraint if exists category_months_user_id_category_id_month_key;
create unique index if not exists category_months_budget_cat_month_uidx
  on public.category_months (budget_id, category_id, month);

drop index if exists import_batches_user_content_hash_uidx;
create unique index if not exists import_batches_budget_content_hash_uidx
  on public.import_batches (budget_id, content_hash)
  where content_hash is not null and status = 'completed';

drop index if exists transactions_user_import_fingerprint_uidx;
create unique index if not exists transactions_budget_import_fingerprint_uidx
  on public.transactions (budget_id, import_fingerprint)
  where import_fingerprint is not null;

create index if not exists idx_accounts_budget on public.accounts (budget_id);
create index if not exists idx_transactions_budget_date on public.transactions (budget_id, occurred_on desc);
create index if not exists idx_category_months_budget_month on public.category_months (budget_id, month);

-- ── Membership helpers (security definer for RLS) ───────────────────
create or replace function public.is_budget_member(p_budget_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.budget_members m
    where m.budget_id = p_budget_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.budget_role(p_budget_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.budget_members m
  where m.budget_id = p_budget_id and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.has_budget_role(p_budget_id uuid, p_min_role text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r text;
  rank_have int;
  rank_need int;
begin
  r := public.budget_role(p_budget_id);
  if r is null then return false; end if;
  rank_have := case r
    when 'viewer' then 1
    when 'editor' then 2
    when 'admin' then 3
    when 'owner' then 4
    else 0 end;
  rank_need := case p_min_role
    when 'viewer' then 1
    when 'editor' then 2
    when 'admin' then 3
    when 'owner' then 4
    else 99 end;
  return rank_have >= rank_need;
end;
$$;

-- ── Signup: profile + default budget ────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_budget_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.budgets (name, created_by)
  values ('My budget', new.id)
  returning id into new_budget_id;

  insert into public.budget_members (budget_id, user_id, role)
  values (new_budget_id, new.id, 'owner');

  update public.profiles set current_budget_id = new_budget_id where id = new.id;

  return new;
end;
$$;

-- ── RLS: drop old policies, add membership policies ─────────────────
alter table public.budgets enable row level security;
alter table public.budget_members enable row level security;
alter table public.budget_invites enable row level security;

drop policy if exists "accounts_all_own" on public.accounts;
drop policy if exists "category_groups_all_own" on public.category_groups;
drop policy if exists "categories_all_own" on public.categories;
drop policy if exists "budget_months_all_own" on public.budget_months;
drop policy if exists "category_months_all_own" on public.category_months;
drop policy if exists "transactions_all_own" on public.transactions;
drop policy if exists "import_batches_all_own" on public.import_batches;

create policy "budgets_select_member" on public.budgets for select
  using (public.is_budget_member(id));
create policy "budgets_insert_authenticated" on public.budgets for insert
  with check (auth.uid() = created_by);
create policy "budgets_update_admin" on public.budgets for update
  using (public.has_budget_role(id, 'admin'));
create policy "budgets_delete_owner" on public.budgets for delete
  using (public.has_budget_role(id, 'owner'));

create policy "budget_members_select" on public.budget_members for select
  using (
    auth.uid() = user_id
    or public.is_budget_member(budget_id)
  );
create policy "budget_members_insert_admin" on public.budget_members for insert
  with check (public.has_budget_role(budget_id, 'admin') or auth.uid() = user_id);
create policy "budget_members_update_admin" on public.budget_members for update
  using (public.has_budget_role(budget_id, 'admin'));
create policy "budget_members_delete" on public.budget_members for delete
  using (
    public.has_budget_role(budget_id, 'admin')
    or auth.uid() = user_id
  );

create policy "budget_invites_select_admin" on public.budget_invites for select
  using (public.has_budget_role(budget_id, 'admin'));
create policy "budget_invites_insert_admin" on public.budget_invites for insert
  with check (public.has_budget_role(budget_id, 'admin') and auth.uid() = created_by);
create policy "budget_invites_update_admin" on public.budget_invites for update
  using (public.has_budget_role(budget_id, 'admin'));

create policy "accounts_select_member" on public.accounts for select
  using (public.is_budget_member(budget_id));
create policy "accounts_write_editor" on public.accounts for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (public.has_budget_role(budget_id, 'editor'));

create policy "category_groups_select_member" on public.category_groups for select
  using (public.is_budget_member(budget_id));
create policy "category_groups_write_editor" on public.category_groups for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (
    public.has_budget_role(budget_id, 'editor')
  );

create policy "categories_select_member" on public.categories for select
  using (public.is_budget_member(budget_id));
create policy "categories_write_editor" on public.categories for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (
    public.has_budget_role(budget_id, 'editor')
    and exists (
      select 1 from public.category_groups g
      where g.id = group_id and g.budget_id = budget_id
    )
  );

create policy "budget_months_select_member" on public.budget_months for select
  using (public.is_budget_member(budget_id));
create policy "budget_months_write_editor" on public.budget_months for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (public.has_budget_role(budget_id, 'editor'));

create policy "category_months_select_member" on public.category_months for select
  using (public.is_budget_member(budget_id));
create policy "category_months_write_editor" on public.category_months for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (
    public.has_budget_role(budget_id, 'editor')
    and exists (
      select 1 from public.categories c
      where c.id = category_id and c.budget_id = budget_id
    )
  );

create policy "transactions_select_member" on public.transactions for select
  using (public.is_budget_member(budget_id));
create policy "transactions_write_editor" on public.transactions for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (
    public.has_budget_role(budget_id, 'editor')
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.budget_id = budget_id
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id and c.budget_id = budget_id
      )
    )
    and (
      import_batch_id is null
      or exists (
        select 1 from public.import_batches b
        where b.id = import_batch_id and b.budget_id = budget_id
      )
    )
  );

create policy "import_batches_select_member" on public.import_batches for select
  using (public.is_budget_member(budget_id));
create policy "import_batches_write_editor" on public.import_batches for all
  using (public.has_budget_role(budget_id, 'editor'))
  with check (public.has_budget_role(budget_id, 'editor'));

-- Join via invite token (bypasses invite select RLS; validates hash server-side).
create or replace function public.accept_budget_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.budget_invites%rowtype;
  join_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv
  from public.budget_invites
  where token_hash = p_token_hash
    and revoked_at is null
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    raise exception 'Invite expired';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'Invite has no uses left';
  end if;

  join_role := case
    when inv.kind = 'shared' then 'editor'
    else coalesce(inv.role, 'editor')
  end;

  insert into public.budget_members (budget_id, user_id, role)
  values (inv.budget_id, auth.uid(), join_role)
  on conflict (budget_id, user_id) do update
    set role = case
      when public.budget_members.role = 'owner' then 'owner'
      when excluded.role = 'owner' then 'owner'
      when public.budget_members.role = 'admin' or excluded.role = 'admin' then 'admin'
      when public.budget_members.role = 'editor' or excluded.role = 'editor' then 'editor'
      else 'viewer'
    end;

  update public.budget_invites set uses = uses + 1 where id = inv.id;
  update public.profiles set current_budget_id = inv.budget_id where id = auth.uid();

  return inv.budget_id;
end;
$$;

grant execute on function public.is_budget_member(uuid) to authenticated, service_role;
grant execute on function public.budget_role(uuid) to authenticated, service_role;
grant execute on function public.has_budget_role(uuid, text) to authenticated, service_role;
grant execute on function public.accept_budget_invite(text) to authenticated, service_role;

grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.budget_members to authenticated;
grant select, insert, update, delete on public.budget_invites to authenticated;
