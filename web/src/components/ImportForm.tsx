"use client";

import { useState, useTransition } from "react";
import { importYnabCsvAction, type ImportActionResult } from "@/lib/actions";

export function ImportForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportActionResult | null>(null);

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    startTransition(async () => {
      try {
        const text = await file.text();
        const next = await importYnabCsvAction({
          csvText: text,
          filename: file.name,
        });
        setResult(next);
      } catch (error) {
        setResult({
          ok: false,
          inserted: 0,
          skipped: 0,
          errors: [error instanceof Error ? error.message : "Upload failed"],
          message: "Could not read or import that file.",
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-ink-900/20 bg-sand-50/80 px-4 py-10 text-center shadow-soft transition hover:border-moss-400 hover:bg-sand-100">
        <span className="font-display text-xl font-bold text-ink-900">
          {pending ? "Importing…" : "Upload YNAB CSV"}
        </span>
        <span className="mt-2 max-w-xs text-sm text-ink-600">
          Export Budget from YNAB web, then upload the register CSV
          (`…Register….csv`).
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={pending}
          onChange={onFileChange}
        />
      </label>

      <div className="rounded-2xl bg-coral-400/10 px-4 py-3 text-sm text-ink-700">
        Fresh exports are safe — already-imported transactions are skipped by
        fingerprint. Exact file re-uploads of a completed import are blocked;
        failed imports can be retried.
      </div>

      {result ? (
        <div
          className={`rounded-3xl px-4 py-4 shadow-soft ${
            result.ok ? "bg-moss-500/10" : "bg-coral-400/15"
          }`}
        >
          <p className="font-semibold text-ink-900">{result.message}</p>
          <p className="mt-2 text-sm text-ink-700">
            Inserted {result.inserted} · Skipped {result.skipped}
          </p>
          {result.errors.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-600">
              {result.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
