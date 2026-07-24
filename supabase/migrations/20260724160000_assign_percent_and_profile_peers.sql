-- Category auto-assign percentages + allow budget peers to see display names

alter table public.categories
  add column if not exists assign_percent numeric(5, 2) not null default 0;

alter table public.categories
  drop constraint if exists categories_assign_percent_check;

alter table public.categories
  add constraint categories_assign_percent_check
  check (assign_percent >= 0 and assign_percent <= 100);

comment on column public.categories.assign_percent is
  'Share of Ready to Assign (0–100) used by Auto-assign.';

-- Co-members can read each other's display names (own-row policy already exists).
drop policy if exists "profiles_select_budget_peers" on public.profiles;
create policy "profiles_select_budget_peers" on public.profiles for select
  using (
    exists (
      select 1
      from public.budget_members me
      join public.budget_members them
        on them.budget_id = me.budget_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
    )
  );
