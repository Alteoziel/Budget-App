-- Deduplicate YNAB CSV imports by content hash (same file → skip).

alter table public.import_batches
  add column if not exists content_hash text;

create unique index if not exists import_batches_user_content_hash_uidx
  on public.import_batches (user_id, content_hash)
  where content_hash is not null;
