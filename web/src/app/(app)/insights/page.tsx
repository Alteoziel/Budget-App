import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { InsightsCharts } from "@/components/insights/InsightsCharts";
import { getInsightSeries } from "@/lib/insights/series";
import { tipsFromFindings } from "@/lib/insights/tips";
import { computeTrendFindings } from "@/lib/insights/trends";

type Search = {
  months?: string;
  accounts?: string;
  categories?: string;
};

function parseCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const monthsBack = Math.min(24, Math.max(3, Number(sp.months ?? "12") || 12));
  const accountIds = parseCsv(sp.accounts);
  const categoryIds = parseCsv(sp.categories);
  const filters = {
    monthsBack,
    accountIds: accountIds.length ? accountIds : undefined,
    categoryIds: categoryIds.length ? categoryIds : undefined,
  };

  const [{ points, accounts, categories }, findings] = await Promise.all([
    getInsightSeries(filters),
    computeTrendFindings(filters),
  ]);
  const tips = tipsFromFindings(findings);

  const hrefFor = (next: {
    months?: number;
    accounts?: string[];
    categories?: string[];
  }) => {
    const params = new URLSearchParams();
    params.set("months", String(next.months ?? monthsBack));
    const a = next.accounts ?? accountIds;
    const c = next.categories ?? categoryIds;
    if (a.length) params.set("accounts", a.join(","));
    if (c.length) params.set("categories", c.join(","));
    return `/insights?${params.toString()}`;
  };

  return (
    <AppShell title="Insights" subtitle="Trends & tips">
      <p className="mb-4 text-sm text-ink-600">
        Charts and trends show what happened. Tips below turn those signals into
        next steps.
      </p>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {[6, 12, 18, 24].map((n) => (
          <Link
            key={n}
            href={hrefFor({ months: n })}
            className={`rounded-xl px-3 py-1.5 font-bold ${
              monthsBack === n ? "bg-ink-900 text-sand-50" : "bg-sand-100 text-ink-600"
            }`}
          >
            {n} mo
          </Link>
        ))}
        <Link
          href="/insights?months=12"
          className="rounded-xl border border-ink-900/10 px-3 py-1.5 font-bold text-ink-600"
        >
          Reset
        </Link>
      </div>

      {accounts.length ? (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {accounts.map((a) => {
            const on = accountIds.includes(a.id);
            const next = on
              ? accountIds.filter((id) => id !== a.id)
              : [...accountIds, a.id];
            return (
              <Link
                key={a.id}
                href={hrefFor({ accounts: next })}
                className={`rounded-xl px-3 py-1.5 font-semibold ${
                  on ? "bg-moss-500 text-sand-50" : "bg-sand-100 text-ink-600"
                }`}
              >
                {a.name}
              </Link>
            );
          })}
        </div>
      ) : null}

      {categories.length ? (
        <div className="mb-6 flex max-h-28 flex-wrap gap-2 overflow-y-auto text-xs">
          {categories.map((c) => {
            const on = categoryIds.includes(c.id);
            const next = on
              ? categoryIds.filter((id) => id !== c.id)
              : [...categoryIds, c.id];
            return (
              <Link
                key={c.id}
                href={hrefFor({ categories: next })}
                className={`rounded-xl px-3 py-1.5 font-semibold ${
                  on ? "bg-ink-900 text-sand-50" : "bg-sand-100 text-ink-600"
                }`}
              >
                {c.name}
              </Link>
            );
          })}
        </div>
      ) : null}

      <InsightsCharts points={points} />

      <section className="mt-6 space-y-3">
        <h2 className="font-display text-lg font-bold text-ink-900">Trends</h2>
        {!findings.length ? (
          <p className="text-sm text-ink-600">Not enough history for trend signals yet.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="rounded-3xl bg-sand-50/80 px-4 py-3 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{f.title}</p>
                  <SeverityBadge severity={f.severity} />
                </div>
                <p className="mt-1 text-sm text-ink-600">{f.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink-900">Tips for you</h2>
          <p className="mt-1 text-sm text-ink-600">
            Actionable next steps based on your trends — not the same cards again.
          </p>
        </div>
        {!tips.length ? (
          <p className="text-sm text-ink-600">
            Tips show up once there is enough history for a clear recommendation.
          </p>
        ) : (
          <ul className="space-y-2">
            {tips.map((tip) => (
              <li key={tip.id} className="rounded-3xl bg-moss-500/10 px-4 py-3 shadow-soft">
                <p className="text-sm font-semibold text-ink-900">{tip.headline}</p>
                <p className="mt-1 text-sm text-ink-600">{tip.body}</p>
                {tip.actions.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tip.actions.map((a) =>
                      a.href ? (
                        <Link
                          key={a.href + a.label}
                          href={a.href}
                          className="rounded-lg bg-moss-500 px-2.5 py-1 text-xs font-bold text-sand-50"
                        >
                          {a.label}
                        </Link>
                      ) : null,
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

function SeverityBadge({ severity }: { severity: "info" | "watch" | "alert" }) {
  const styles =
    severity === "alert"
      ? "bg-coral-400/20 text-coral-500"
      : severity === "watch"
        ? "bg-amber-100 text-amber-900"
        : "bg-sand-100 text-ink-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${styles}`}>
      {severity}
    </span>
  );
}
