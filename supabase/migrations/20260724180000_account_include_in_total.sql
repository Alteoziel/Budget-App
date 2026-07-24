-- Persist which accounts count toward the Accounts tab "All accounts" total.

alter table public.accounts
  add column if not exists include_in_total boolean not null default true;

comment on column public.accounts.include_in_total is
  'When true, this account balance is included in the All accounts total.';
