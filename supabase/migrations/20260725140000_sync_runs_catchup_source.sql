-- Allow catch-up syncs (app-open fallback when the daily cron misses).

alter table public.sync_runs drop constraint if exists sync_runs_source_check;
alter table public.sync_runs
  add constraint sync_runs_source_check
  check (source in ('teller', 'plaid', 'cron', 'manual', 'catchup'));
