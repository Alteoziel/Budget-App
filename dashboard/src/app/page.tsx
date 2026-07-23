import Link from "next/link";
import type { ReactNode } from "react";
import {
  dashboardAuthStatus,
  type DashboardAuthStatus,
} from "@/lib/auth";
import {
  getReview,
  getStoreStatus,
  listReviews,
  sanitizeReviewForClient,
  type Review,
  type StoreStatus,
} from "@/lib/store";
import { siteGateEnabled } from "@/lib/siteAuth";
import { ReviewDetail } from "@/components/ReviewPanel";
import { SiteLogoutButton } from "@/components/SiteLogoutButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = {
  searchParams: Promise<{ id?: string }>;
};

function StatusPill({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
        ok ? "bg-signal/15 text-signal" : "bg-alert/15 text-alert"
      }`}
    >
      {children}
    </span>
  );
}

function SetupStatusPanel({
  auth,
  storeStatus,
  siteGate,
}: {
  auth: DashboardAuthStatus;
  storeStatus: StoreStatus;
  siteGate: boolean;
}) {
  const ingestReady = auth.dashboardSecretConfigured || auth.insecureDevAllowed;
  const reviewerReady =
    auth.reviewerSecretConfigured || auth.dashboardSecretConfigured || auth.insecureDevAllowed;

  return (
    <section className="mb-8 rounded-xl border border-white/10 bg-slatepanel/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-mist">
            Deployment readiness
          </p>
          <h2 className="mt-2 font-display text-2xl text-white">
            Dashboard auth and ingest status
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-mist">
            CI ingest uses <code>{auth.ingestHeader}</code>. Missing or wrong
            ingest secrets return HTTP 401 from <code>/api/reviews</code>, so
            set <code>GOVERNANCE_DASHBOARD_SECRET</code> on both GitHub Actions
            and the dashboard host.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill ok={siteGate}>
            {siteGate ? "site password on" : "site password off"}
          </StatusPill>
          <StatusPill ok={ingestReady}>
            {ingestReady ? "ingest ready" : "ingest locked"}
          </StatusPill>
          <StatusPill ok={reviewerReady}>
            {reviewerReady ? "review actions ready" : "review actions locked"}
          </StatusPill>
          <StatusPill ok={auth.mergeTokenConfigured}>
            {auth.mergeTokenConfigured ? "merge token set" : "merge token missing"}
          </StatusPill>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm text-mist md:grid-cols-2">
        <div className="rounded-md bg-black/25 p-3">
          <dt className="font-semibold text-white">Ingest secret</dt>
          <dd>
            {auth.dashboardSecretConfigured
              ? "Configured. CI must send X-Governance-Secret."
              : auth.insecureDevAllowed
                ? "Missing, but local insecure dev mode is enabled."
                : "Missing. CI dashboard POSTs will be rejected with 401."}
          </dd>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <dt className="font-semibold text-white">Reviewer unlock</dt>
          <dd>
            {auth.reviewerSecretConfigured
              ? "Uses GOVERNANCE_REVIEWER_SECRET via X-Governance-Reviewer-Secret."
              : auth.reviewerUsesDashboardSecret && auth.dashboardSecretConfigured
                ? "Falls back to GOVERNANCE_DASHBOARD_SECRET for approve/merge."
                : "Locked until a reviewer or dashboard secret is configured."}
          </dd>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <dt className="font-semibold text-white">Store</dt>
          <dd>
            {storeStatus.backend === "redis"
              ? "Using durable Upstash Redis."
              : storeStatus.durable
                ? "Using a durable store."
                : "Using in-memory fallback storage; data resets when the process restarts."}
          </dd>
        </div>
        <div className="rounded-md bg-black/25 p-3">
          <dt className="font-semibold text-white">Runtime mode</dt>
          <dd>
            {auth.production
              ? "Production mode; insecure dev unlock is ignored."
              : auth.insecureDevAllowed
                ? "Local insecure dev mode is enabled. Do not use this in production."
                : "Local mode with normal shared-secret auth."}
          </dd>
        </div>
        <div className="rounded-md bg-black/25 p-3 md:col-span-2">
          <dt className="font-semibold text-white">Site password gate</dt>
          <dd>
            {siteGate
              ? "GOVERNANCE_SITE_PASSWORD is set. Visitors must sign in; browser sessions last 7 days."
              : "Unset. The review UI is publicly readable. Set GOVERNANCE_SITE_PASSWORD on Vercel to enable the gate."}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default async function HomePage({ searchParams }: Props) {
  const auth = dashboardAuthStatus();
  let id: string | undefined;
  try {
    ({ id } = await searchParams);
  } catch {
    id = undefined;
  }

  let reviews: Review[] = [];
  let selected: Review | null = null;
  let loadError: string | null = null;
  const storeStatus = getStoreStatus();

  try {
    reviews = await listReviews();
    const selectedRaw = id ? await getReview(id) : reviews[0] ?? null;
    selected = selectedRaw ? sanitizeReviewForClient(selectedRaw) : null;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Store unavailable";
    console.error("[governance-dashboard] page load failed", err);
  }

  const banner = loadError || storeStatus.warning;
  const siteGate = siteGateEnabled();

  return (
    <main>
      <header className="mb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-mist">
              Budget App
            </p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-white md:text-6xl">
              Governance
            </h1>
          </div>
          {siteGate ? <SiteLogoutButton /> : null}
        </div>
        <p className="mt-4 max-w-2xl text-lg text-mist">
          Review AST, OWASP, fuzz, Big-O, and copyright reports before merging
          to <code className="text-white/80">main</code>.
        </p>
      </header>

      <SetupStatusPanel
        auth={auth}
        storeStatus={storeStatus}
        siteGate={siteGate}
      />

      {banner ? (
        <div
          className="mb-8 rounded-xl border border-warn/40 bg-warn/10 p-6 text-sm text-mist"
          role="alert"
        >
          <p className="font-semibold text-warn">Dashboard store notice</p>
          <p className="mt-2">{banner}</p>
          <p className="mt-3">
            Vercel project → Storage → create Upstash Redis → connect to this
            project → ensure env vars apply to Production and Preview →
            Redeploy. Also set{" "}
            <code className="text-white/80">GOVERNANCE_DASHBOARD_SECRET</code>.
          </p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-mist">
            Pending &amp; recent
          </h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-mist">
              No reviews yet. CI will POST here when{" "}
              <code>GOVERNANCE_DASHBOARD_URL</code> is set to this deployment
              URL and <code>GOVERNANCE_DASHBOARD_SECRET</code> matches the
              Vercel env var exactly. A 401 in the Actions log means the
              secrets do not match — fix them, then re-run{" "}
              <strong className="font-semibold text-white">
                Governance Steps 1–5
              </strong>
              .
            </p>
          ) : (
            <ul className="space-y-2">
              {reviews.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/?id=${r.id}`}
                    className={`block rounded-lg px-3 py-3 text-sm transition ${
                      selected?.id === r.id
                        ? "bg-slatepanel ring-1 ring-signal/40"
                        : "bg-slatepanel/70 hover:bg-slatepanel"
                    }`}
                  >
                    <span className="font-semibold text-white">
                      {r.repo ?? "local"}
                      {r.pr_number ? ` #${r.pr_number}` : ""}
                    </span>
                    <span className="mt-1 block text-xs text-mist">
                      {r.status.replaceAll("_", " ")} ·{" "}
                      {r.passed ? "suite pass" : "suite fail"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div>
          {selected ? (
            <ReviewDetail review={selected as Review} />
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 p-10 text-mist">
              Waiting for the first guardrail report from GitHub Actions.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
