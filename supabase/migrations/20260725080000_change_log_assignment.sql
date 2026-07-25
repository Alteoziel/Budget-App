-- Allow auto-assign (and other month assignment) entries in the 7-day undo log.

alter table public.budget_change_log
  drop constraint if exists budget_change_log_entity_type_check;

alter table public.budget_change_log
  add constraint budget_change_log_entity_type_check
  check (
    entity_type in (
      'transaction',
      'account',
      'category',
      'category_group',
      'assignment'
    )
  );
