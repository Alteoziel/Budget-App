"use client";

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
    <div className="rounded-xl border border-ink-900/10 bg-sand-50 px-3 py-2 text-xs shadow-soft">
      <p className="font-semibold text-ink-900">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} style={{ color: p.color }} className="text-ink-600">
          {p.name}: {formatCents(Math.round(Number(p.value ?? 0) * 100))}
        </p>
      ))}
    </div>
  );
}

export function InsightsCharts({ points }: Props) {
  const data = points.map((p) => ({
    month: p.month,
    spending: p.spendingCents / 100,
    income: p.incomeCents / 100,
    balance: p.endBalanceCents / 100,
  }));
  const empty = !data.length;

  return (
    <div className="space-y-4">
      <ChartCard title="Spending over time" empty={empty}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(21,36,31,0.12)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="spending" fill="#c45c3a" name="Spending" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Income over time" empty={empty}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(21,36,31,0.12)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="income" fill="#3f7a5c" name="Income" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="End-of-month account value" empty={empty}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(21,36,31,0.12)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<MoneyTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#15241f"
              strokeWidth={2}
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
    <section className="rounded-3xl bg-sand-50/80 p-4 shadow-soft">
      <h2 className="mb-3 font-display text-lg font-bold text-ink-900">{title}</h2>
      {empty ? (
        <p className="py-10 text-center text-sm text-ink-600">No data in this range yet.</p>
      ) : (
        children
      )}
    </section>
  );
}
