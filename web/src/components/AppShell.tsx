/** Page title block — shell chrome lives in layout via AppChrome. */
export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="animate-rise relative z-50 mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
            {title}
          </h1>
          {subtitle ? <div className="mt-1">{subtitle}</div> : null}
        </div>
        {actions ? <div className="shrink-0 pt-1">{actions}</div> : null}
      </header>
      {children}
    </>
  );
}
