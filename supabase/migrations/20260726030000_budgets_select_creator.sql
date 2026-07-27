-- Allow budget creators to SELECT a newly inserted budget so
-- insert(...).select(...).single() can return the id before membership exists.
-- Membership bootstrap (can_bootstrap_budget_membership) already keys off created_by.

drop policy if exists "budgets_select_member" on public.budgets;
create policy "budgets_select_member" on public.budgets for select
  using (
    public.is_budget_member(id)
    or auth.uid() = created_by
  );
