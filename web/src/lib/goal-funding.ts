import { isValidIsoDate } from "@/lib/money";
import type { GoalFrequency } from "@/lib/types";

function parseLocalYmd(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/** How many frequency periods remain from asOf through dueOn (inclusive), at least 1. */
export function countPeriodsUntilDue(
  asOfIso: string,
  dueOnIso: string,
  frequency: GoalFrequency,
): number {
  if (!isValidIsoDate(asOfIso) || !isValidIsoDate(dueOnIso)) return 1;

  const asOf = parseLocalYmd(asOfIso);
  const due = parseLocalYmd(dueOnIso);
  if (due.getTime() <= asOf.getTime()) return 1;

  if (frequency === "once") return 1;

  if (frequency === "weekly") {
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.ceil((due.getTime() - asOf.getTime()) / dayMs);
    return Math.max(1, Math.ceil(days / 7));
  }

  const monthsInclusive = Math.max(1, monthIndex(due) - monthIndex(asOf) + 1);
  if (frequency === "monthly") return monthsInclusive;
  if (frequency === "quarterly") return Math.max(1, Math.ceil(monthsInclusive / 3));
  if (frequency === "yearly") return Math.max(1, Math.ceil(monthsInclusive / 12));
  return 1;
}

export type GoalFundingPlan = {
  remainingCents: number;
  periodsLeft: number;
  perPeriodCents: number;
};

/** Required contribution per selected frequency to hit the goal by the due date. */
export function requiredContributionCents(opts: {
  goalCents: number;
  availableCents: number;
  frequency: GoalFrequency;
  goalDueOn: string | null;
  asOfIso: string;
}): GoalFundingPlan | null {
  if (!opts.goalDueOn || !isValidIsoDate(opts.goalDueOn)) return null;
  if (!Number.isFinite(opts.goalCents) || opts.goalCents <= 0) return null;

  const remainingCents = Math.max(0, Math.round(opts.goalCents) - Math.round(opts.availableCents));
  const periodsLeft = countPeriodsUntilDue(
    opts.asOfIso,
    opts.goalDueOn,
    opts.frequency,
  );
  const perPeriodCents =
    remainingCents === 0 ? 0 : Math.ceil(remainingCents / periodsLeft);

  return { remainingCents, periodsLeft, perPeriodCents };
}

export function frequencyPeriodLabel(frequency: GoalFrequency): string {
  switch (frequency) {
    case "weekly":
      return "week";
    case "monthly":
      return "month";
    case "quarterly":
      return "quarter";
    case "yearly":
      return "year";
    case "once":
      return "one-time";
    default:
      return "period";
  }
}
