-- Security audit hardening.
-- Each checkpoint below closes a verified authorization or tenant-isolation gap.

-- CHECKPOINT 1: prevent arbitrary self-enrollment / owner escalation.
create or replace function public.can_bootstrap_budget_membership(
  p_budget_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() = p_user_id
    and p_role = 'owner'
    and exists (
      select 1
      from public.budgets b
      where b.id = p_budget_id
        and b.created_by = auth.uid()
    )
    and not exists (
      select 1
      from public.budget_members m
      where m.budget_id = p_budget_id
    );
$$;

revoke all on function public.can_bootstrap_budget_membership(uuid, uuid, text)
  from public, anon;
grant execute on function public.can_bootstrap_budget_membership(uuid, uuid, text)
  to authenticated, service_role;

drop policy if exists "budget_members_insert_admin" on public.budget_members;
drop policy if exists "budget_members_insert_authorized" on public.budget_members;
create policy "budget_members_insert_authorized"
on public.budget_members for insert
with check (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and role <> 'owner'
  )
  or public.can_bootstrap_budget_membership(budget_id, user_id, role)
);

-- CHECKPOINT 2: admins may manage non-owner access, but only owners may grant,
-- change, revoke, or remove owner access.
drop policy if exists "budget_members_update_admin" on public.budget_members;
drop policy if exists "budget_members_update_authorized" on public.budget_members;
create policy "budget_members_update_authorized"
on public.budget_members for update
using (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and role <> 'owner'
  )
)
with check (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and role <> 'owner'
  )
);

drop policy if exists "budget_members_delete" on public.budget_members;
drop policy if exists "budget_members_delete_authorized" on public.budget_members;
create policy "budget_members_delete_authorized"
on public.budget_members for delete
using (
  auth.uid() = user_id
  or public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and role <> 'owner'
  )
);

create or replace function public.protect_last_budget_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (
       new.budget_id is distinct from old.budget_id
       or new.user_id is distinct from old.user_id
     ) then
    raise exception 'Membership identity cannot be changed';
  end if;

  -- Cascading deletion of the parent budget is allowed to remove its members.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.budgets b where b.id = old.budget_id
  ) then
    return old;
  end if;

  -- Serialize owner-count changes for this budget so two concurrent requests
  -- cannot both observe another owner and remove the final two.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(old.budget_id::text, 0)
  );
  if old.role = 'owner'
     and (
       tg_op = 'DELETE'
       or (tg_op = 'UPDATE' and new.role <> 'owner')
     )
     and (
       select count(*)
       from public.budget_members m
       where m.budget_id = old.budget_id
         and m.role = 'owner'
     ) <= 1 then
    raise exception 'Transfer ownership before removing the last owner';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_last_budget_owner on public.budget_members;
create trigger protect_last_budget_owner
before update or delete on public.budget_members
for each row execute function public.protect_last_budget_owner();

drop policy if exists "budget_invites_insert_admin" on public.budget_invites;
drop policy if exists "budget_invites_insert_authorized" on public.budget_invites;
create policy "budget_invites_insert_authorized"
on public.budget_invites for insert
with check (
  auth.uid() = created_by
  and (
    public.has_budget_role(budget_id, 'owner')
    or (
      public.has_budget_role(budget_id, 'admin')
      and coalesce(role, 'editor') <> 'owner'
    )
  )
);

drop policy if exists "budget_invites_update_admin" on public.budget_invites;
drop policy if exists "budget_invites_update_authorized" on public.budget_invites;
create policy "budget_invites_update_authorized"
on public.budget_invites for update
using (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and coalesce(role, 'editor') <> 'owner'
  )
)
with check (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and coalesce(role, 'editor') <> 'owner'
  )
);

-- Revoke any owner invite that was created by someone who is not an owner.
update public.budget_invites i
set revoked_at = coalesce(i.revoked_at, now())
where coalesce(i.role, 'editor') = 'owner'
  and not exists (
    select 1
    from public.budget_members m
    where m.budget_id = i.budget_id
      and m.user_id = i.created_by
      and m.role = 'owner'
  );

create or replace function public.accept_budget_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
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
  if inv.expires_at is not null and inv.expires_at < pg_catalog.now() then
    raise exception 'Invite expired';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'Invite has no uses left';
  end if;

  join_role := case
    when inv.kind = 'shared' then 'editor'
    else coalesce(inv.role, 'editor')
  end;

  if join_role = 'owner' then
    perform 1
    from public.budget_members creator
    where creator.budget_id = inv.budget_id
      and creator.user_id = inv.created_by
      and creator.role = 'owner'
    for share;
    if not found then
      raise exception 'The owner who created this invite no longer has owner access';
    end if;
  end if;

  insert into public.budget_members (budget_id, user_id, role)
  values (inv.budget_id, auth.uid(), join_role)
  on conflict (budget_id, user_id) do update
    set role = case
      when public.budget_members.role = 'owner' then 'owner'
      when excluded.role = 'owner' then 'owner'
      when public.budget_members.role = 'admin'
        or excluded.role = 'admin' then 'admin'
      when public.budget_members.role = 'editor'
        or excluded.role = 'editor' then 'editor'
      else 'viewer'
    end;

  update public.budget_invites
  set uses = uses + 1
  where id = inv.id;

  update public.profiles
  set current_budget_id = inv.budget_id
  where id = auth.uid();

  return inv.budget_id;
end;
$$;

revoke all on function public.accept_budget_invite(text) from public, anon;
grant execute on function public.accept_budget_invite(text)
  to authenticated, service_role;

create or replace function public.delete_revoked_budget_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.budget_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv
  from public.budget_invites
  where id = p_invite_id;

  if not found then
    raise exception 'Invite not found';
  end if;

  if not (
    public.has_budget_role(inv.budget_id, 'owner')
    or (
      public.has_budget_role(inv.budget_id, 'admin')
      and coalesce(inv.role, 'editor') <> 'owner'
    )
  ) then
    raise exception 'Not allowed';
  end if;

  if inv.revoked_at is null then
    raise exception 'Revoke the invite first, then you can delete it from history';
  end if;

  delete from public.budget_invites where id = p_invite_id;
  return true;
end;
$$;

revoke all on function public.delete_revoked_budget_invite(uuid)
  from public, anon;
grant execute on function public.delete_revoked_budget_invite(uuid)
  to authenticated, service_role;

drop policy if exists "budget_invites_delete_admin" on public.budget_invites;
drop policy if exists "budget_invites_delete_authorized" on public.budget_invites;
create policy "budget_invites_delete_authorized"
on public.budget_invites for delete
using (
  public.has_budget_role(budget_id, 'owner')
  or (
    public.has_budget_role(budget_id, 'admin')
    and coalesce(role, 'editor') <> 'owner'
  )
);

-- CHECKPOINT 3: bank-account mappings must stay inside one budget.
delete from public.plaid_accounts pa
where not exists (
    select 1
    from public.plaid_items pi
    where pi.id = pa.plaid_item_id
      and pi.budget_id = pa.budget_id
  )
  or not exists (
    select 1
    from public.accounts a
    where a.id = pa.account_id
      and a.budget_id = pa.budget_id
  );

delete from public.teller_accounts ta
where not exists (
    select 1
    from public.teller_enrollments te
    where te.id = ta.enrollment_id
      and te.budget_id = ta.budget_id
  )
  or not exists (
    select 1
    from public.accounts a
    where a.id = ta.account_id
      and a.budget_id = ta.budget_id
  );

create unique index if not exists accounts_budget_id_id_uidx
  on public.accounts (budget_id, id);
create unique index if not exists plaid_items_budget_id_id_uidx
  on public.plaid_items (budget_id, id);
create unique index if not exists teller_enrollments_budget_id_id_uidx
  on public.teller_enrollments (budget_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'plaid_accounts_item_same_budget_fk'
      and conrelid = 'public.plaid_accounts'::regclass
  ) then
    alter table public.plaid_accounts
      add constraint plaid_accounts_item_same_budget_fk
      foreign key (budget_id, plaid_item_id)
      references public.plaid_items (budget_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'plaid_accounts_account_same_budget_fk'
      and conrelid = 'public.plaid_accounts'::regclass
  ) then
    alter table public.plaid_accounts
      add constraint plaid_accounts_account_same_budget_fk
      foreign key (budget_id, account_id)
      references public.accounts (budget_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'teller_accounts_enrollment_same_budget_fk'
      and conrelid = 'public.teller_accounts'::regclass
  ) then
    alter table public.teller_accounts
      add constraint teller_accounts_enrollment_same_budget_fk
      foreign key (budget_id, enrollment_id)
      references public.teller_enrollments (budget_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'teller_accounts_account_same_budget_fk'
      and conrelid = 'public.teller_accounts'::regclass
  ) then
    alter table public.teller_accounts
      add constraint teller_accounts_account_same_budget_fk
      foreign key (budget_id, account_id)
      references public.accounts (budget_id, id)
      on delete cascade;
  end if;
end
$$;

drop policy if exists "plaid_items_select" on public.plaid_items;
create policy "plaid_items_select_admin"
on public.plaid_items for select
using (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "plaid_accounts_select" on public.plaid_accounts;
create policy "plaid_accounts_select_admin"
on public.plaid_accounts for select
using (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "plaid_accounts_write" on public.plaid_accounts;
create policy "plaid_accounts_write"
on public.plaid_accounts for all
using (public.has_budget_role(budget_id, 'admin'))
with check (
  public.has_budget_role(budget_id, 'admin')
  and exists (
    select 1 from public.plaid_items pi
    where pi.id = plaid_accounts.plaid_item_id
      and pi.budget_id = plaid_accounts.budget_id
  )
  and exists (
    select 1 from public.accounts a
    where a.id = plaid_accounts.account_id
      and a.budget_id = plaid_accounts.budget_id
  )
);

drop policy if exists "teller_enrollments_select" on public.teller_enrollments;
create policy "teller_enrollments_select_admin"
on public.teller_enrollments for select
using (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "teller_accounts_select" on public.teller_accounts;
create policy "teller_accounts_select_admin"
on public.teller_accounts for select
using (public.has_budget_role(budget_id, 'admin'));

drop policy if exists "teller_accounts_write" on public.teller_accounts;
create policy "teller_accounts_write"
on public.teller_accounts for all
using (public.has_budget_role(budget_id, 'admin'))
with check (
  public.has_budget_role(budget_id, 'admin')
  and exists (
    select 1 from public.teller_enrollments te
    where te.id = teller_accounts.enrollment_id
      and te.budget_id = teller_accounts.budget_id
  )
  and exists (
    select 1 from public.accounts a
    where a.id = teller_accounts.account_id
      and a.budget_id = teller_accounts.budget_id
  )
);

-- CHECKPOINT 4: match suggestions may reference only same-budget rows.
delete from public.transaction_match_suggestions s
where not exists (
    select 1 from public.accounts a
    where a.id = s.account_id and a.budget_id = s.budget_id
  )
  or not exists (
    select 1 from public.transactions t
    where t.id = s.manual_transaction_id
      and t.budget_id = s.budget_id
      and t.account_id = s.account_id
  )
  or not exists (
    select 1 from public.transactions t
    where t.id = s.bank_transaction_id
      and t.budget_id = s.budget_id
      and t.account_id = s.account_id
  );

create unique index if not exists transactions_budget_id_id_uidx
  on public.transactions (budget_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'suggestions_account_same_budget_fk'
      and conrelid = 'public.transaction_match_suggestions'::regclass
  ) then
    alter table public.transaction_match_suggestions
      add constraint suggestions_account_same_budget_fk
      foreign key (budget_id, account_id)
      references public.accounts (budget_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'suggestions_manual_same_budget_fk'
      and conrelid = 'public.transaction_match_suggestions'::regclass
  ) then
    alter table public.transaction_match_suggestions
      add constraint suggestions_manual_same_budget_fk
      foreign key (budget_id, manual_transaction_id)
      references public.transactions (budget_id, id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'suggestions_bank_same_budget_fk'
      and conrelid = 'public.transaction_match_suggestions'::regclass
  ) then
    alter table public.transaction_match_suggestions
      add constraint suggestions_bank_same_budget_fk
      foreign key (budget_id, bank_transaction_id)
      references public.transactions (budget_id, id)
      on delete cascade;
  end if;
end
$$;

drop policy if exists "transaction_match_suggestions_write"
  on public.transaction_match_suggestions;
create policy "transaction_match_suggestions_write"
on public.transaction_match_suggestions for all
using (public.has_budget_role(budget_id, 'editor'))
with check (
  public.has_budget_role(budget_id, 'editor')
  and exists (
    select 1 from public.accounts a
    where a.id = transaction_match_suggestions.account_id
      and a.budget_id = transaction_match_suggestions.budget_id
  )
  and exists (
    select 1 from public.transactions t
    where t.id = transaction_match_suggestions.manual_transaction_id
      and t.budget_id = transaction_match_suggestions.budget_id
      and t.account_id = transaction_match_suggestions.account_id
  )
  and exists (
    select 1 from public.transactions t
    where t.id = transaction_match_suggestions.bank_transaction_id
      and t.budget_id = transaction_match_suggestions.budget_id
      and t.account_id = transaction_match_suggestions.account_id
  )
);

-- CHECKPOINT 7: authenticated users may not control unscoped sync logs.
delete from public.sync_runs where budget_id is null;

drop policy if exists "sync_runs_select" on public.sync_runs;
create policy "sync_runs_select"
on public.sync_runs for select
using (
  budget_id is not null
  and public.is_budget_member(budget_id)
);

drop policy if exists "sync_runs_write" on public.sync_runs;
create policy "sync_runs_write"
on public.sync_runs for all
using (
  budget_id is not null
  and public.has_budget_role(budget_id, 'admin')
)
with check (
  budget_id is not null
  and public.has_budget_role(budget_id, 'admin')
);

-- Authenticated callers must scope cleanup to a budget they can access.
-- The service role may still perform global expiry maintenance.
create or replace function public.purge_expired_budget_change_log(
  p_budget_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_budget_id is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'A budget is required';
    end if;

    delete from public.budget_change_log
    where expires_at < pg_catalog.now();
  else
    if coalesce(auth.role(), '') <> 'service_role'
       and not public.is_budget_member(p_budget_id) then
      raise exception 'Not a budget member';
    end if;

    delete from public.budget_change_log
    where budget_id = p_budget_id
      and expires_at < pg_catalog.now();
  end if;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_budget_change_log(uuid)
  from public, anon;
grant execute on function public.purge_expired_budget_change_log(uuid)
  to authenticated, service_role;

-- CHECKPOINT 10: authorize private Presence/Broadcast channels by membership.
create or replace function public.can_access_budget_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.budget_members m
    where m.user_id = auth.uid()
      and p_topic = 'budget-live:' || m.budget_id::text
  );
$$;

revoke all on function public.can_access_budget_realtime_topic(text)
  from public, anon;
grant execute on function public.can_access_budget_realtime_topic(text)
  to authenticated, service_role;

drop policy if exists "budget members read private realtime"
  on realtime.messages;
create policy "budget members read private realtime"
on realtime.messages for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.can_access_budget_realtime_topic(
    (select realtime.topic())
  )
);

drop policy if exists "budget members write private realtime"
  on realtime.messages;
create policy "budget members write private realtime"
on realtime.messages for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.can_access_budget_realtime_topic(
    (select realtime.topic())
  )
);

-- CHECKPOINT 5 follow-up: serialize overspend fixes per budget/month.
create table if not exists public.overspend_fix_locks (
  budget_id uuid not null references public.budgets (id) on delete cascade,
  month text not null,
  lock_token uuid not null,
  expires_at timestamptz not null,
  primary key (budget_id, month)
);

alter table public.overspend_fix_locks enable row level security;
revoke all on table public.overspend_fix_locks from public, anon, authenticated;

create or replace function public.acquire_overspend_fix_lock(
  p_budget_id uuid,
  p_month text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if auth.uid() is null
     or not public.has_budget_role(p_budget_id, 'editor') then
    raise exception 'Not allowed';
  end if;
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid month';
  end if;

  delete from public.overspend_fix_locks
  where budget_id = p_budget_id
    and month = p_month
    and expires_at < pg_catalog.now();

  insert into public.overspend_fix_locks (
    budget_id,
    month,
    lock_token,
    expires_at
  )
  values (
    p_budget_id,
    p_month,
    p_lock_token,
    pg_catalog.now() + interval '15 minutes'
  )
  on conflict (budget_id, month) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.release_overspend_fix_lock(
  p_budget_id uuid,
  p_month text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null
     or not public.has_budget_role(p_budget_id, 'editor') then
    raise exception 'Not allowed';
  end if;

  delete from public.overspend_fix_locks
  where budget_id = p_budget_id
    and month = p_month
    and lock_token = p_lock_token;

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

revoke all on function public.acquire_overspend_fix_lock(uuid, text, uuid)
  from public, anon;
revoke all on function public.release_overspend_fix_lock(uuid, text, uuid)
  from public, anon;
grant execute on function public.acquire_overspend_fix_lock(uuid, text, uuid)
  to authenticated;
grant execute on function public.release_overspend_fix_lock(uuid, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
