-- Hard-delete revoked invites via a security-definer RPC so admins aren't
-- blocked when the DELETE RLS policy hasn't been applied yet (silent 0-row deletes).

create or replace function public.delete_revoked_budget_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
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

  if not public.has_budget_role(inv.budget_id, 'admin') then
    raise exception 'Not allowed';
  end if;

  if inv.revoked_at is null then
    raise exception 'Revoke the invite first, then you can delete it from history';
  end if;

  delete from public.budget_invites where id = p_invite_id;
  return true;
end;
$$;

grant execute on function public.delete_revoked_budget_invite(uuid) to authenticated, service_role;

-- Keep / refresh the direct DELETE policy as well.
drop policy if exists "budget_invites_delete_admin" on public.budget_invites;
create policy "budget_invites_delete_admin" on public.budget_invites
  for delete using (public.has_budget_role(budget_id, 'admin'));

grant delete on public.budget_invites to authenticated;
