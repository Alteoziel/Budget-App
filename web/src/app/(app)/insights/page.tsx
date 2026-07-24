import { AppShell } from "@/components/AppShell";
import { InsightsExplorer } from "@/components/insights/InsightsExplorer";
import { getInsightsDataset } from "@/lib/insights/dataset";

export default async function InsightsPage() {
  const dataset = await getInsightsDataset();

  return (
    <AppShell title="Insights" subtitle="Trends & tips">
      <p className="mb-4 text-sm text-ink-600">
        Charts and trends show what happened. Tips below turn those signals into next
        steps. Filters apply instantly — the data is loaded once.
      </p>
      <InsightsExplorer dataset={dataset} />
    </AppShell>
  );
}
