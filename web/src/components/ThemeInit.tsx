"use client";

import { useEffect } from "react";
import {
  applyDocumentThemeChrome,
  resolveIsDark,
  type ThemePref,
} from "@/lib/theme-chrome";

const THEME_STORAGE_KEY = "alte-theme";

function readPref(): ThemePref {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Re-apply theme after hydration so React never leaves light CSS tokens stuck
 * between the blocking boot script and the first data paint.
 */
export function ThemeInit() {
  useEffect(() => {
    const pref = readPref();
    applyDocumentThemeChrome(
      resolveIsDark(pref, window.matchMedia("(prefers-color-scheme: dark)").matches),
    );

    if (pref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyDocumentThemeChrome(resolveIsDark("system", media.matches));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return null;
}
