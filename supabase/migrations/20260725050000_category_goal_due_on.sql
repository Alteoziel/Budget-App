-- Optional due date for category goals; used to derive required funding per frequency period.

alter table public.categories
  add column if not exists goal_due_on date;

comment on column public.categories.goal_due_on is
  'When set, remaining goal balance is divided across frequency periods until this date.';
