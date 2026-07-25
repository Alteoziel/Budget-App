-- Re-assert Realtime publication for shared budget tables.
-- Safe to re-run. Required for live assign/transaction sync across members.
-- After applying: reload the API schema in the Supabase dashboard if changes
-- don’t show up within a minute.

alter table public.transactions replica identity full;
alter table public.categories replica identity full;
alter table public.category_groups replica identity full;
alter table public.category_months replica identity full;
alter table public.accounts replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.transactions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.categories;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.category_groups;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.category_months;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.accounts;
  exception when duplicate_object then null;
  end;
end $$;
