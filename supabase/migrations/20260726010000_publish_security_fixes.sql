-- Publish-readiness security fixes:
-- 1) Invite redeem accepts raw token (hash stays server-side); hide token_hash from clients
-- 2) Single-use invites + 30-day expiry defaults for existing open invites
-- 3) Stop auth.users deletion from cascading away shared budgets / money / bank links
-- 4) Hide bank access_token_encrypted from authenticated SELECT

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1 + 2. Invites: raw-token accept RPC, column lockdown, expiry defaults
-- ---------------------------------------------------------------------------

update public.budget_invites
set
  max_uses = coalesce(max_uses, 1),
  expires_at = coalesce(
    expires_at,
    coalesce(created_at, pg_catalog.now()) + interval '30 days'
  )
where revoked_at is null
  and (max_uses is null or expires_at is null);

-- Same SQL type (text) as before, but argument is now the raw invite token.
drop function if exists public.accept_budget_invite(text);

create function public.accept_budget_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.budget_invites%rowtype;
  join_role text;
  token_hash text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'Invite token missing';
  end if;

  -- Must match Node createHash('sha256').update(token).digest('hex')
  token_hash := encode(
    extensions.digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'),
    'hex'
  );

  select * into inv
  from public.budget_invites
  where public.budget_invites.token_hash = token_hash
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

  -- Consume invite so the token cannot be reused after acceptance.
  update public.budget_invites
  set
    uses = uses + 1,
    revoked_at = coalesce(revoked_at, pg_catalog.now()),
    expires_at = least(
      coalesce(expires_at, pg_catalog.now()),
      pg_catalog.now()
    )
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

revoke all on table public.budget_invites from public, anon;
revoke all on table public.budget_invites from authenticated;
grant select (
  id,
  budget_id,
  kind,
  role,
  uses,
  max_uses,
  expires_at,
  revoked_at,
  created_by,
  created_at
) on table public.budget_invites to authenticated;
grant insert, update, delete on table public.budget_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deletion protection: do not wipe shared household data on auth user delete
-- ---------------------------------------------------------------------------

alter table public.budgets
  alter column created_by drop not null;

do $$
declare
  c name;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.budgets'::regclass
      and con.contype = 'f'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%(created_by)%'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.budgets drop constraint %I', c);
  end loop;
end
$$;

alter table public.budgets
  add constraint budgets_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.budget_invites
  alter column created_by drop not null;

do $$
declare
  c name;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.budget_invites'::regclass
      and con.contype = 'f'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%(created_by)%'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.budget_invites drop constraint %I', c);
  end loop;
end
$$;

alter table public.budget_invites
  add constraint budget_invites_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.plaid_items
  alter column created_by drop not null;

do $$
declare
  c name;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.plaid_items'::regclass
      and con.contype = 'f'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%(created_by)%'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.plaid_items drop constraint %I', c);
  end loop;
end
$$;

alter table public.plaid_items
  add constraint plaid_items_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.teller_enrollments
  alter column created_by drop not null;

do $$
declare
  c name;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.teller_enrollments'::regclass
      and con.contype = 'f'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%(created_by)%'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.teller_enrollments drop constraint %I', c);
  end loop;
end
$$;

alter table public.teller_enrollments
  add constraint teller_enrollments_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.budget_change_log
  alter column actor_user_id drop not null;

do $$
declare
  c name;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.budget_change_log'::regclass
      and con.contype = 'f'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%(actor_user_id)%'
      and pg_catalog.pg_get_constraintdef(con.oid) ilike '%auth.users%'
  loop
    execute format('alter table public.budget_change_log drop constraint %I', c);
  end loop;
end
$$;

alter table public.budget_change_log
  add constraint budget_change_log_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users (id) on delete set null;

do $$
declare
  tbl text;
  c name;
begin
  foreach tbl in array array[
    'accounts',
    'category_groups',
    'categories',
    'budget_months',
    'category_months',
    'transactions',
    'import_batches'
  ]
  loop
    execute format(
      'alter table public.%I alter column user_id drop not null',
      tbl
    );
    for c in
      select con.conname
      from pg_catalog.pg_constraint con
      where con.conrelid = ('public.' || tbl)::regclass
        and con.contype = 'f'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%(user_id)%'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%auth.users%'
    loop
      execute format('alter table public.%I drop constraint %I', tbl, c);
    end loop;
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users (id) on delete set null',
      tbl,
      tbl || '_user_id_fkey'
    );
  end loop;
end
$$;

-- Sole owners still cannot delete their login while they remain the last owner:
-- auth.users delete cascades to budget_members and protect_last_budget_owner blocks it.

-- ---------------------------------------------------------------------------
-- 4. Bank token ciphertext: no authenticated SELECT
-- ---------------------------------------------------------------------------

revoke all on table public.plaid_items from public, anon;
revoke all on table public.plaid_items from authenticated;
grant select (
  id,
  budget_id,
  item_id,
  institution_id,
  institution_name,
  status,
  sync_cursor,
  created_by,
  last_synced_at,
  last_error,
  created_at,
  updated_at
) on table public.plaid_items to authenticated;
grant insert, update, delete on table public.plaid_items to authenticated;

revoke all on table public.teller_enrollments from public, anon;
revoke all on table public.teller_enrollments from authenticated;
grant select (
  id,
  budget_id,
  enrollment_id,
  institution_name,
  status,
  created_by,
  last_synced_at,
  last_error,
  created_at,
  updated_at
) on table public.teller_enrollments to authenticated;
grant insert, update, delete on table public.teller_enrollments to authenticated;
