-- Clarify that ignored transactions are excluded from insights only.
-- They still appear in account registers and count toward balances.

comment on column public.transactions.ignored is
  'When true, this transaction is excluded from insights. Account balances and registers still include it.';
