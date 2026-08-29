import { AppShell } from "@/components/AppShell";
import { InsightsExplorer } from "@/components/insights/InsightsExplorer";
import { getInsightsDataset } from "@/lib/insights/dataset";

export default async function InsightsPage() {
  const dataset = await getInsightsDataset();

  return (
    <AppShell title="Insights" subtitle="Ins and outs">
      <p className="mb-4 text-sm text-ink-600">
        See spending and income by month, or expand charts for a longer view.
        Chart filters apply instantly — the data is loaded once.
      </p>
      <InsightsExplorer dataset={dataset} />
    </AppShell>
  );
}
