"use client";

import { useId, useState } from "react";

export function SettingsCategory({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="mt-8 first:mt-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="mb-3 flex w-full touch-manipulation items-start justify-between gap-3 rounded-2xl px-1 py-1 text-left outline-none ring-moss-400 focus-visible:ring-2"
      >
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-ink-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink-600">{description}</p> : null}
        </div>
        <span
          aria-hidden
          className={`mt-1 shrink-0 text-ink-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open ? (
        <div id={panelId} className="space-y-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
