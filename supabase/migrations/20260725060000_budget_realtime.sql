-- Enable Supabase Realtime for shared budget tables so collaborators see live updates.
-- Filters use budget_id; REPLICA IDENTITY FULL keeps that column available on UPDATE/DELETE.

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
