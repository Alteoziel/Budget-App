-- Auto-assign can be a percent of Ready to Assign or a fixed dollar amount.

alter table public.categories
  add column if not exists assign_mode text not null default 'percent';

alter table public.categories
  add column if not exists assign_fixed_cents bigint not null default 0;

alter table public.categories
  drop constraint if exists categories_assign_mode_check;

alter table public.categories
  add constraint categories_assign_mode_check
  check (assign_mode in ('percent', 'fixed'));

alter table public.categories
  drop constraint if exists categories_assign_fixed_cents_check;

alter table public.categories
  add constraint categories_assign_fixed_cents_check
  check (assign_fixed_cents >= 0);

comment on column public.categories.assign_mode is
  'How Auto-assign funds this category: percent of Ready to Assign, or a fixed dollar amount.';

comment on column public.categories.assign_fixed_cents is
  'Fixed cents Auto-assign adds when assign_mode = fixed.';
