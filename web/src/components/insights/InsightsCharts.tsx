"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthPoint } from "@/lib/insights/series";
import { formatCents } from "@/lib/money";

type Props = {
  points: MonthPoint[];
};

type ChartColors = {
  grid: string;
  axis: string;
  spending: string;
  income: string;
  balance: string;
};

const LIGHT: ChartColors = {
  grid: "rgba(21,36,31,0.14)",
  axis: "#3a5c4f",
  spending: "#c45c3a",
  income: "#3f7a5c",
  balance: "#15241f",
};

const DARK: ChartColors = {
  grid: "rgba(196,214,205,0.22)",
  axis: "#c6d6cd",
  spending: "#e08a68",
  income: "#8fbf9a",
  // Near-black ink disappears on dark cards — use a bright moss line instead.
  balance: "#b7d9bf",
};

function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(LIGHT);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setColors(root.classList.contains("dark") ? DARK : LIGHT);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ink-900/15 bg-sand-50 px-3 py-2 text-xs shadow-soft">
      <p className="font-semibold text-ink-900">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} style={{ color: p.color }} className="text-ink-700">
          {p.name}: {formatCents(Math.round(Number(p.value ?? 0) * 100))}
        </p>
      ))}
    </div>
  );
}

export function InsightsCharts({ points }: Props) {
  const colors = useChartColors();
  const data = points.map((p) => ({
    month: p.month,
    spending: p.spendingCents / 100,
    income: p.incomeCents / 100,
    balance: p.endBalanceCents / 100,
  }));
  const empty = !data.length;
  const tick = { fontSize: 11, fill: colors.axis };

  return (
    <div className="space-y-4">
      <ChartCard title="Spending over time" empty={empty}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="month" tick={tick} stroke={colors.axis} />
            <YAxis tick={tick} stroke={colors.axis} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar
              dataKey="spending"
              fill={colors.spending}
              name="Spending"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Income over time" empty={empty}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="month" tick={tick} stroke={colors.axis} />
            <YAxis tick={tick} stroke={colors.axis} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="income" fill={colors.income} name="Income" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="End-of-month account value" empty={empty}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="month" tick={tick} stroke={colors.axis} />
            <YAxis tick={tick} stroke={colors.axis} />
            <Tooltip content={<MoneyTooltip />} />
            <Legend wrapperStyle={{ color: colors.axis }} />
            <Line
              type="monotone"
              dataKey="balance"
              stroke={colors.balance}
              strokeWidth={2.5}
              name="Balance"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface rounded-2xl p-4">
      <h2 className="mb-3 font-display text-lg font-bold text-ink-900">{title}</h2>
      {empty ? (
        <p className="py-10 text-center text-sm text-ink-600">No data in this range yet.</p>
      ) : (
        children
      )}
    </section>
  );
}
