/** Page title block — shell chrome lives in layout via AppChrome. */
export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="animate-rise mb-4 min-w-0">
        <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
          {title}
        </h1>
        {subtitle ? <div className="mt-1">{subtitle}</div> : null}
      </header>
      {children}
    </>
  );
}
