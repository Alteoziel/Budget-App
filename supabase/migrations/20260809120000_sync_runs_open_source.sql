-- Allow open-app / resume bank syncs to record sync_runs.source = 'open'.
alter table public.sync_runs drop constraint if exists sync_runs_source_check;
alter table public.sync_runs
  add constraint sync_runs_source_check
  check (source in ('teller', 'plaid', 'cron', 'manual', 'catchup', 'open'));
