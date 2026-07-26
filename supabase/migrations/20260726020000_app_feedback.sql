-- User feedback / feature requests submitted from Settings.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  budget_id uuid references public.budgets (id) on delete set null,
  kind text not null
    check (kind in ('feedback', 'request', 'bug')),
  message text not null
    check (char_length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists idx_app_feedback_user_created
  on public.app_feedback (user_id, created_at desc);

alter table public.app_feedback enable row level security;

drop policy if exists "app_feedback_insert_own" on public.app_feedback;
create policy "app_feedback_insert_own"
on public.app_feedback for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    budget_id is null
    or public.is_budget_member(budget_id)
  )
);

drop policy if exists "app_feedback_select_own" on public.app_feedback;
create policy "app_feedback_select_own"
on public.app_feedback for select
to authenticated
using (auth.uid() = user_id);

revoke all on table public.app_feedback from public, anon;
grant select, insert on table public.app_feedback to authenticated;
grant all on table public.app_feedback to service_role;
