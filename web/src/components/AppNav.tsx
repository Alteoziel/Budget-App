"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/budget", label: "Budget", prefetch: true },
  { href: "/accounts", label: "Accounts", prefetch: true },
  { href: "/insights", label: "Insights", prefetch: true },
  // Heavy dynamic page — prefetch just queues a second full fetch on mobile.
  { href: "/transactions", label: "Transactions", prefetch: false },
  { href: "/settings", label: "Settings", prefetch: true },
] as const;

function navClass(active: boolean) {
  // Hover styles only on real hover pointers — iOS sticky :hover was leaving
  // a “pressed” look when the route never committed.
  return `touch-manipulation flex items-center justify-center rounded-xl px-2 py-2.5 text-xs font-bold transition sm:text-sm ${
    active
      ? "bg-moss-500 text-sand-50"
      : "text-ink-700 [@media(hover:hover)]:hover:bg-sand-100 active:bg-sand-200"
  }`;
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Bottom tab bar — phones / narrow viewports only.
 * Sits in normal document flow at the bottom of the app shell (not `fixed`)
 * so mobile Safari/Chrome can’t leave a gap after long actions like Sync now.
 */
export function MobileBottomNav() {
  const pathname = usePathname() || "/budget";
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
    document.documentElement.dataset.alteNavPending = "";
  }, [pathname]);

  // If a soft nav is cancelled, don't leave refresh gated forever.
  useEffect(() => {
    if (!pendingHref) return;
    const timer = window.setTimeout(() => {
      setPendingHref(null);
      document.documentElement.dataset.alteNavPending = "";
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

  return (
    <nav
      className="shrink-0 border-t border-ink-900/10 bg-sand-50 lg:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 gap-1 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2">
        {links.map((link) => {
          const active =
            pendingHref != null
              ? pendingHref === link.href
              : isActivePath(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                prefetch={link.prefetch}
                className={navClass(active)}
                onClick={() => {
                  if (isActivePath(pathname, link.href)) return;
                  setPendingHref(link.href);
                  document.documentElement.dataset.alteNavPending = "1";
                }}
                onTouchEnd={(event) => {
                  // Drop iOS sticky :hover/:focus after the tap.
                  event.currentTarget.blur();
                }}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Left sidebar — desktop / large tablets. */
export function DesktopSideNav() {
  const pathname = usePathname() || "/budget";
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
    document.documentElement.dataset.alteNavPending = "";
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return;
    const timer = window.setTimeout(() => {
      setPendingHref(null);
      document.documentElement.dataset.alteNavPending = "";
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

  return (
    <nav
      className="hidden w-56 shrink-0 flex-col border-r border-ink-900/10 bg-sand-50/60 px-3 py-6 lg:flex"
      aria-label="Primary"
    >
      <p className="px-2 text-[11px] font-bold uppercase tracking-[0.2em] text-moss-500">
        Navigate
      </p>
      <ul className="mt-3 space-y-1">
        {links.map((link) => {
          const active =
            pendingHref != null
              ? pendingHref === link.href
              : isActivePath(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                prefetch={link.prefetch}
                onClick={() => {
                  if (isActivePath(pathname, link.href)) return;
                  setPendingHref(link.href);
                  document.documentElement.dataset.alteNavPending = "1";
                }}
                className={`touch-manipulation flex min-h-11 items-center rounded-xl px-3 text-sm font-bold transition ${
                  active
                    ? "bg-moss-500 text-sand-50"
                    : "text-ink-800 [@media(hover:hover)]:hover:bg-sand-100 active:bg-sand-200"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
