import { BottomNav } from "@/components/BottomNav";
import { signOutAction } from "@/lib/actions";

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
    <div className="min-h-dvh bg-app-glow">
      <header className="mx-auto flex max-w-lg items-start justify-between gap-4 px-5 pb-2 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-moss-500">
            Alte&apos; Budgeting
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-ink-900">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-600">{subtitle}</p> : null}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-600 hover:bg-sand-100"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="safe-pb mx-auto max-w-lg px-5 pb-8 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}
