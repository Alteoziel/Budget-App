"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/budget", label: "Budget", prefetch: true },
  { href: "/accounts", label: "Accounts", prefetch: true },
  { href: "/insights", label: "Insights", prefetch: true },
  // Heavy dynamic page — prefetch just queues a second full fetch on mobile.
  {
    href: "/transactions",
    label: "Transactions",
    prefetch: false,
    badgeKey: "uncategorized" as const,
  },
  { href: "/settings", label: "Settings", prefetch: true },
] as const;

function navClass(active: boolean) {
  // Hover styles only on real hover pointers — iOS sticky :hover was leaving
  // a “pressed” look when the route never committed.
  return `touch-manipulation relative flex items-center justify-center rounded-xl px-2 py-2.5 text-xs font-bold transition sm:text-sm ${
    active
      ? "bg-moss-500 text-sand-50"
      : "text-ink-700 [@media(hover:hover)]:hover:bg-sand-100 active:bg-sand-200"
  }`;
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function UncategorizedBadge({
  count,
  active,
}: {
  count: number;
  active: boolean;
}) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className={`absolute -right-0.5 -top-0.5 inline-flex min-h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-md px-1 text-[10px] font-bold leading-none ${
        active ? "bg-sand-50 text-moss-600" : "bg-coral-500 text-sand-50"
      }`}
      aria-label={`${count} uncategorized transaction${count === 1 ? "" : "s"}`}
    >
      {label}
    </span>
  );
}

type PendingNav = { href: string; fromPath: string };

function usePendingTab(pathname: string) {
  const [pending, setPending] = useState<PendingNav | null>(null);

  // Pending only applies while we're still on the path we left from. Once the
  // route commits, pathname changes and this becomes null without an effect.
  const pendingHref =
    pending && pending.fromPath === pathname ? pending.href : null;

  // Sync nav-pending flag for realtime refresh gating (external DOM system).
  useEffect(() => {
    document.documentElement.dataset.alteNavPending = pendingHref ? "1" : "";
  }, [pendingHref]);

  // If a soft nav is cancelled, don't leave refresh gated forever.
  useEffect(() => {
    if (!pendingHref) return;
    const timer = window.setTimeout(() => {
      setPending(null);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

  function beginPending(href: string) {
    if (isActivePath(pathname, href)) return;
    setPending({ href, fromPath: pathname });
  }

  return { pendingHref, beginPending };
}

/**
 * Bottom tab bar — phones / narrow viewports only.
 * Sits in normal document flow at the bottom of the app shell (not `fixed`)
 * so mobile Safari/Chrome can’t leave a gap after long actions like Sync now.
 */
export function MobileBottomNav({
  uncategorizedCount = 0,
}: {
  uncategorizedCount?: number;
}) {
  const pathname = usePathname() || "/budget";
  const { pendingHref, beginPending } = usePendingTab(pathname);

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
                onClick={() => beginPending(link.href)}
                onTouchEnd={(event) => {
                  // Drop iOS sticky :hover/:focus after the tap.
                  event.currentTarget.blur();
                }}
              >
                {link.label}
                {"badgeKey" in link && link.badgeKey === "uncategorized" ? (
                  <UncategorizedBadge
                    count={uncategorizedCount}
                    active={active}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Left sidebar — desktop / large tablets. */
export function DesktopSideNav({
  uncategorizedCount = 0,
}: {
  uncategorizedCount?: number;
}) {
  const pathname = usePathname() || "/budget";
  const { pendingHref, beginPending } = usePendingTab(pathname);

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
                onClick={() => beginPending(link.href)}
                className={`touch-manipulation relative flex min-h-11 items-center rounded-xl px-3 text-sm font-bold transition ${
                  active
                    ? "bg-moss-500 text-sand-50"
                    : "text-ink-800 [@media(hover:hover)]:hover:bg-sand-100 active:bg-sand-200"
                }`}
              >
                <span className="flex-1">{link.label}</span>
                {"badgeKey" in link &&
                link.badgeKey === "uncategorized" &&
                uncategorizedCount > 0 ? (
                  <span
                    className={`ml-2 inline-flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-md px-1.5 text-[11px] font-bold ${
                      active
                        ? "bg-sand-50 text-moss-600"
                        : "bg-coral-500 text-sand-50"
                    }`}
                    aria-label={`${uncategorizedCount} uncategorized`}
                  >
                    {uncategorizedCount > 99 ? "99+" : uncategorizedCount}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
