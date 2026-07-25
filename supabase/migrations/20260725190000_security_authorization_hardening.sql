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
