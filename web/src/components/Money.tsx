import { formatCents } from "@/lib/money";

export function Money({
  cents,
  className = "",
}: {
  cents: number;
  className?: string;
}) {
  const tone =
    cents < 0 ? "text-coral-500" : cents > 0 ? "text-moss-500" : "text-ink-700";
  return (
    <span className={`tabular-nums ${className || tone}`}>{formatCents(cents)}</span>
  );
}
