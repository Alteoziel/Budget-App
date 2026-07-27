-- Allow categories to opt out of funding overspent categories in Fix Now.
alter table public.categories
  add column if not exists exclude_from_overspend_cover boolean not null default false;

comment on column public.categories.exclude_from_overspend_cover is
  'When true, this category is hidden from Fix Now donor lists and cannot fund overspending.';
