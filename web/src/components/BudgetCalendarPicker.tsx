"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  currentIsoDate,
  formatBudgetDate,
  formatBudgetMonth,
  maxAssignableBudgetMonth,
  nextBudgetMonth,
  previousBudgetMonth,
} from "@/lib/money";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function daysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m, 0).getDate();
}

function firstWeekday(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).getDay();
}

function isoDay(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

function panelPositionFromButton(button: HTMLButtonElement | null) {
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  const panelWidth = Math.min(window.innerWidth - 32, 19 * 16);
  const left = Math.max(
    16,
    Math.min(rect.left, window.innerWidth - panelWidth - 16),
  );
  return { top: rect.bottom + 8, left };
}

/**
 * Month/day picker. The popover is portaled to document.body so it stacks above
 * the sticky Ready to assign bar (transform / high z-index stacking contexts).
 */
export function BudgetCalendarPicker({
  selectedAs,
  currentMonth,
  buttonLabel,
}: {
  /** YYYY-MM or YYYY-MM-DD when viewing a snapshot; null for live budget. */
  selectedAs: string | null;
  currentMonth: string;
  buttonLabel: string;
}) {
  const router = useRouter();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [viewMonth, setViewMonth] = useState(
    () => selectedAs?.slice(0, 7) ?? currentMonth,
  );
  const today = currentIsoDate();
  const maxFutureMonth = maxAssignableBudgetMonth(currentMonth);

  function close() {
    setOpen(false);
    setPanelPos(null);
  }

  function toggleOpen() {
    if (open) {
      close();
      return;
    }
    setViewMonth(selectedAs?.slice(0, 7) ?? currentMonth);
    setPanelPos(panelPositionFromButton(buttonRef.current));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function place() {
      setPanelPos(panelPositionFromButton(buttonRef.current));
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function go(as: string | null) {
    close();
    if (!as) {
      router.push("/budget");
      return;
    }
    router.push(`/budget?as=${encodeURIComponent(as)}`);
  }

  function selectMonth(month: string) {
    if (month === currentMonth) {
      go(null);
      return;
    }
    go(month);
  }

  function selectDay(date: string) {
    go(date);
  }

  const blanks = firstWeekday(viewMonth);
  const totalDays = daysInMonth(viewMonth);
  const prev = previousBudgetMonth(viewMonth);
  const next = nextBudgetMonth(viewMonth);
  const canGoNext =
    Boolean(next) &&
    Boolean(maxFutureMonth) &&
    (next as string) <= (maxFutureMonth as string);
  const selectedDay =
    selectedAs && selectedAs.length === 10 ? selectedAs : null;
  const selectedMonthOnly =
    selectedAs && selectedAs.length === 7 ? selectedAs : null;
  const isLive = selectedAs == null;
  const viewIsFuture = viewMonth > currentMonth;
  const viewIsPast = viewMonth < currentMonth;

  const panel =
    open && panelPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Choose a budget date"
            style={{ top: panelPos.top, left: panelPos.left }}
            className="fixed z-[70] w-[min(100vw-2rem,19rem)] rounded-2xl border border-ink-900/20 bg-sand-50 p-3 shadow-soft ring-1 ring-ink-900/5 dark:bg-ink-50"
          >
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous month"
                disabled={!prev}
                onClick={() => prev && setViewMonth(prev)}
                className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl text-ink-700 hover:bg-ink-900/5 disabled:opacity-30"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => selectMonth(viewMonth)}
                title={
                  viewIsFuture
                    ? "Assign into this future month"
                    : viewIsPast
                      ? "View this month’s snapshot"
                      : "Back to this month’s budget"
                }
                className={`min-h-9 flex-1 touch-manipulation rounded-xl px-2 text-sm font-bold transition ${
                  selectedMonthOnly === viewMonth ||
                  (isLive && viewMonth === currentMonth)
                    ? "bg-ink-900 text-sand-50"
                    : "text-ink-900 hover:bg-ink-900/5"
                }`}
              >
                {formatBudgetMonth(viewMonth)}
              </button>
              <button
                type="button"
                aria-label="Next month"
                disabled={!canGoNext}
                onClick={() => next && setViewMonth(next)}
                className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl text-ink-700 hover:bg-ink-900/5 disabled:opacity-30"
              >
                ›
              </button>
            </div>

            <p className="mb-2 text-center text-[11px] font-semibold text-ink-500">
              {viewIsFuture
                ? "Tap the month to assign Ready to assign into future categories."
                : "Tap the month for a month snapshot, or a day for that day’s snapshot."}
            </p>

            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-bold uppercase tracking-wide text-ink-500">
              {WEEKDAYS.map((day) => (
                <div key={day} className="py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-0.5 grid grid-cols-7 gap-0.5">
              {Array.from({ length: blanks }, (_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: totalDays }, (_, i) => {
                const day = i + 1;
                const date = isoDay(viewMonth, day);
                // Future months are month-level only (assign ahead); no day snapshots.
                const disabled = viewIsFuture || date > today;
                const isSelected = selectedDay === date;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectDay(date)}
                    aria-label={formatBudgetDate(date)}
                    aria-current={isToday ? "date" : undefined}
                    className={`flex h-9 touch-manipulation items-center justify-center rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                      isSelected
                        ? "bg-moss-500 text-sand-50"
                        : isToday
                          ? "bg-moss-100 text-moss-800 ring-1 ring-moss-400/50 dark:bg-moss-200 dark:text-moss-950"
                          : "text-ink-800 hover:bg-ink-900/5"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {!isLive ? (
              <button
                type="button"
                onClick={() => go(null)}
                className="mt-3 w-full touch-manipulation rounded-xl bg-ink-900/5 px-3 py-2 text-sm font-bold text-ink-800 hover:bg-ink-900/10"
              >
                Back to {formatBudgetMonth(currentMonth)}
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggleOpen}
        className="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-xl border border-ink-900/15 bg-sand-50 px-3 py-1.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:border-ink-900/25 hover:bg-white dark:bg-ink-50"
      >
        <span>{buttonLabel}</span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 opacity-70 transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {panel}
    </div>
  );
}
