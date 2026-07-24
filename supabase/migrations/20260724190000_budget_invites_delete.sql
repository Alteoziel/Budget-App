-- Allow admins to hard-delete revoked invite history rows.

drop policy if exists "budget_invites_delete_admin" on public.budget_invites;
create policy "budget_invites_delete_admin" on public.budget_invites
  for delete using (public.has_budget_role(budget_id, 'admin'));

grant delete on public.budget_invites to authenticated;
