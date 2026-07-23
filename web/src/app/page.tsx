import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-app-glow px-6 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-24 h-56 w-56 animate-drift rounded-full bg-moss-300/40 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 bottom-24 h-48 w-48 animate-drift rounded-full bg-coral-400/20 blur-2xl"
      />

      <div className="relative mx-auto flex min-h-[85dvh] max-w-lg flex-col justify-between">
        <div className="animate-rise">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-moss-500">
            Alte&apos; Budgeting
          </p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-tight text-ink-900 sm:text-6xl">
            Give every dollar a job.
          </h1>
          <p className="mt-4 max-w-md text-lg text-ink-700">
            A private, phone-first budget inspired by YNAB — simple today, powerful when you need it.
          </p>
        </div>

        <div className="animate-rise-delay space-y-3 pb-6">
          <Link
            href="/login"
            className="flex w-full items-center justify-center rounded-2xl bg-ink-900 px-5 py-4 text-base font-bold text-sand-50 transition hover:bg-ink-800"
          >
            Get started
          </Link>
          <p className="text-center text-sm text-ink-600">
            Import your YNAB CSV in a couple taps.
          </p>
        </div>
      </div>
    </main>
  );
}
