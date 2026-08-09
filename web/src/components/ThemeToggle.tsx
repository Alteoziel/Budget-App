"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyDocumentThemeChrome,
  resolveIsDark,
  type ThemePref,
} from "@/lib/theme-chrome";

export const THEME_STORAGE_KEY = "alte-theme";

const OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function applyTheme(pref: ThemePref) {
  const dark = resolveIsDark(
    pref,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  applyDocumentThemeChrome(dark);
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readPref(): ThemePref {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as ThemePref);

  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  function choose(next: ThemePref) {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    for (const listener of listeners) listener();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={pref === option.value}
            className={`min-h-11 touch-manipulation rounded-xl px-4 py-2 text-sm font-bold ${
              pref === option.value
                ? "bg-ink-900 text-sand-50"
                : "border border-ink-900/10 bg-white text-ink-700"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-600">
        Saved on this device. System follows your phone or computer setting.
      </p>
    </div>
  );
}
