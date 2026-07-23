"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 text-mist">
      <p className="text-xs uppercase tracking-[0.25em]">Budget App</p>
      <h1 className="mt-3 font-display text-4xl text-white">
        Dashboard hit a server error
      </h1>
      <p className="mt-4 text-sm">
        {error.message || "Unknown error"}
        {error.digest ? (
          <>
            {" "}
            <span className="text-white/50">(digest {error.digest})</span>
          </>
        ) : null}
      </p>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm">
        <li>
          Vercel → Storage → add <strong className="text-white">Upstash Redis</strong>{" "}
          and connect it to this project (Production + Preview).
        </li>
        <li>
          Confirm <code className="text-white/80">UPSTASH_REDIS_REST_URL</code> and{" "}
          <code className="text-white/80">UPSTASH_REDIS_REST_TOKEN</code> exist under
          Environment Variables.
        </li>
        <li>
          Set <code className="text-white/80">GOVERNANCE_DASHBOARD_SECRET</code>, then
          Redeploy.
        </li>
        <li>
          Open Deployment → Logs for the full stack trace if this persists.
        </li>
      </ol>
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-md bg-signal px-4 py-2 text-sm font-semibold text-ink"
      >
        Try again
      </button>
    </main>
  );
}
