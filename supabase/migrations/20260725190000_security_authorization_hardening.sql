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
