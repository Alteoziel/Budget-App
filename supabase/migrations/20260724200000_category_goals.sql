-- Optional per-category goal shown on the budget page in place of raw activity.

alter table public.categories
  add column if not exists goal_cents int,
  add column if not exists goal_name text not null default '',
  add column if not exists goal_frequency text not null default 'monthly',
  add column if not exists goal_note text not null default '';

alter table public.categories drop constraint if exists categories_goal_cents_check;
alter table public.categories
  add constraint categories_goal_cents_check
  check (goal_cents is null or goal_cents >= 0);

alter table public.categories drop constraint if exists categories_goal_frequency_check;
alter table public.categories
  add constraint categories_goal_frequency_check
  check (goal_frequency in ('weekly', 'monthly', 'quarterly', 'yearly', 'once'));

comment on column public.categories.goal_cents is
  'Target amount for this category; null means no goal is set.';
