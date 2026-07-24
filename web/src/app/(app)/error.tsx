"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error.message || "Something went wrong.";
  const looksLikeSchema =
    /relation|column|budget_members|budget_id|does not exist|permission denied/i.test(
      message,
    );

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-coral-500">
        Couldn’t load
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold text-ink-900">
        Server error
      </h1>
      <p className="mt-3 text-sm text-ink-600">{message}</p>
      {looksLikeSchema ? (
        <p className="mt-3 rounded-2xl bg-amber-100/80 px-4 py-3 text-sm text-amber-950">
          This usually means the latest Supabase migrations haven’t been applied yet.
          In the Supabase SQL editor, run the files in{" "}
          <code className="font-mono text-xs">supabase/migrations/</code> in order
          (especially <code className="font-mono text-xs">20260724120000_*</code> and{" "}
          <code className="font-mono text-xs">20260724140000_*</code>).
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50"
      >
        Try again
      </button>
    </div>
  );
}
