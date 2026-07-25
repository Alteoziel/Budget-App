-- Priority Auto-assign (AP): lower positive numbers fund first.

alter table public.categories
  add column if not exists assign_priority integer not null default 0;

alter table public.categories
  drop constraint if exists categories_assign_priority_check;

alter table public.categories
  add constraint categories_assign_priority_check
  check (assign_priority >= 0);

comment on column public.categories.assign_priority is
  'Auto Priority (AP): 0 = excluded from Priority auto-assign; 1 funds before 2, etc.';
