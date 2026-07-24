/** Page title block — shell chrome lives in layout via AppChrome. */
export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="animate-rise mb-4 min-w-0">
        <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-600">{subtitle}</p> : null}
      </header>
      {children}
    </>
  );
}
