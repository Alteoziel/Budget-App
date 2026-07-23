-- Import idempotency, batch status, case-insensitive names, import_batch ownership RLS.

-- 1) Import batches: status so failed/partial imports can be retried
alter table public.import_batches
  add column if not exists status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed'));

-- Only completed imports block identical file re-uploads.
drop index if exists import_batches_user_content_hash_uidx;
create unique index if not exists import_batches_user_content_hash_uidx
  on public.import_batches (user_id, content_hash)
  where content_hash is not null and status = 'completed';

-- 2) Per-transaction import fingerprint (fresh exports skip already-imported rows)
alter table public.transactions
  add column if not exists import_fingerprint text;

create unique index if not exists transactions_user_import_fingerprint_uidx
  on public.transactions (user_id, import_fingerprint)
  where import_fingerprint is not null;

-- 3) Case-insensitive uniqueness for account / group / category names
alter table public.accounts drop constraint if exists accounts_user_id_name_key;
create unique index if not exists accounts_user_lower_name_uidx
  on public.accounts (user_id, lower(name));

alter table public.category_groups drop constraint if exists category_groups_user_id_name_key;
create unique index if not exists category_groups_user_lower_name_uidx
  on public.category_groups (user_id, lower(name));

alter table public.categories drop constraint if exists categories_user_id_group_id_name_key;
create unique index if not exists categories_user_group_lower_name_uidx
  on public.categories (user_id, group_id, lower(name));

-- 4) FK child indexes
create index if not exists idx_categories_group on public.categories (group_id);
create index if not exists idx_category_months_category on public.category_months (category_id);
create index if not exists idx_transactions_import_batch on public.transactions (import_batch_id);

-- 5) RLS: import_batch_id must belong to the same user when set
drop policy if exists "transactions_all_own" on public.transactions;
create policy "transactions_all_own" on public.transactions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = auth.uid()
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories c
        where c.id = category_id and c.user_id = auth.uid()
      )
    )
    and (
      import_batch_id is null
      or exists (
        select 1 from public.import_batches b
        where b.id = import_batch_id and b.user_id = auth.uid()
      )
    )
  );
