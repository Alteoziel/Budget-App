-- Enforce that FK targets (accounts/categories/groups) belong to the same user.
-- Complements RLS user_id checks so clients cannot attach rows to another user's entities.

drop policy if exists "transactions_all_own" on public.transactions;
create policy "transactions_all_own" on public.transactions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id and c.user_id = auth.uid()
      )
    )
  );

drop policy if exists "category_months_all_own" on public.category_months;
create policy "category_months_all_own" on public.category_months for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.categories c
      where c.id = category_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "categories_all_own" on public.categories;
create policy "categories_all_own" on public.categories for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.category_groups g
      where g.id = group_id and g.user_id = auth.uid()
    )
  );
