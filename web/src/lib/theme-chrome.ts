/** Page wash colors — keep in sync with globals.css `--page-bg`. */
export const THEME_PAGE_BG = {
  light: "#e9e3d6",
  dark: "#080c0b",
} as const;

/** Browser chrome / PWA theme-color matching the page wash (avoids white flash). */
export const THEME_CHROME = {
  light: "#e9e3d6",
  dark: "#080c0b",
} as const;

export type ThemePref = "system" | "light" | "dark";

export function resolveIsDark(pref: ThemePref, matchesSystemDark: boolean): boolean {
  return pref === "dark" || (pref === "system" && matchesSystemDark);
}

/** Apply document chrome that must be correct before/without waiting on CSS. */
export function applyDocumentThemeChrome(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.backgroundColor = dark ? THEME_PAGE_BG.dark : THEME_PAGE_BG.light;
  const chrome = dark ? THEME_CHROME.dark : THEME_CHROME.light;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", chrome);
}
