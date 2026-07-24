import { AppShell } from "@/components/AppShell";
import { FlashError } from "@/components/FlashError";
import { TellerConnectButton } from "@/components/TellerConnectButton";
import {
  createBudgetAction,
  createInviteLinkAction,
  disconnectTellerEnrollmentAction,
  leaveBudgetAction,
  removeMemberAction,
  renameBudgetAction,
  revokeInviteAction,
  syncTellerNowAction,
  updateMemberRoleAction,
} from "@/lib/actions";
import { listUserBudgets, requireBudget, roleAtLeast } from "@/lib/budget-context";
import { createClient } from "@/lib/supabase/server";
import { tellerConfigured } from "@/lib/teller/client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invite?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const { budget, role, user } = await requireBudget("viewer");
  const budgets = await listUserBudgets();
  const supabase = await createClient();
  const canAdmin = roleAtLeast(role, "admin");

  const { data: memberRows } = await supabase
    .from("budget_members")
    .select("id,user_id,role")
    .eq("budget_id", budget.id)
    .order("role");

  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id,display_name").in("id", memberIds)
    : { data: [] as Array<{ id: string; display_name: string | null }> };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data: invites } = canAdmin
    ? await supabase
        .from("budget_invites")
        .select("id,kind,role,uses,max_uses,expires_at,revoked_at,created_at")
        .eq("budget_id", budget.id)
        .order("created_at", { ascending: false })
    : { data: [] as Array<Record<string, unknown>> };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  const tellerAppId =
    process.env.NEXT_PUBLIC_TELLER_APPLICATION_ID ||
    process.env.TELLER_APPLICATION_ID ||
    "";
  const tellerEnv = process.env.NEXT_PUBLIC_TELLER_ENVIRONMENT || "development";
  const tellerReady = tellerConfigured();

  // Teller tables may be absent until that migration is applied — don't 500 Settings.
  let enrollments: Array<Record<string, unknown>> = [];
  let lastSync: Record<string, unknown> | null = null;
  if (canAdmin) {
    const enrollRes = await supabase
      .from("teller_enrollments")
      .select(
        "id,institution_name,status,last_synced_at,last_error,created_at,enrollment_id",
      )
      .eq("budget_id", budget.id)
      .neq("status", "disconnected")
      .order("created_at", { ascending: false });
    if (!enrollRes.error) enrollments = enrollRes.data ?? [];

    const syncRes = await supabase
      .from("sync_runs")
      .select("started_at,finished_at,inserted,updated,errors,source")
      .eq("budget_id", budget.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!syncRes.error) lastSync = (syncRes.data as Record<string, unknown> | null) ?? null;
  }

  return (
    <AppShell title="Settings" subtitle={budget.name}>
      <FlashError message={params.error} />

      {params.invite ? (
        <section className="mb-4 rounded-3xl bg-moss-500/10 px-4 py-4 text-sm text-ink-800 shadow-soft">
          <p className="font-semibold text-ink-900">Invite link ready</p>
          <p className="mt-1 break-all text-xs">
            {siteUrl || ""}/invite/{params.invite}
          </p>
          <p className="mt-2 text-xs text-ink-600">
            Kind: {params.kind ?? "shared"}. Copy now — the raw token is only shown once.
          </p>
        </section>
      ) : null}

      <section className="space-y-3 rounded-3xl bg-sand-50/80 p-4 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-900">Your budgets</h2>
        <ul className="space-y-2 text-sm">
          {budgets.map((b) => (
            <li key={b.id} className="flex justify-between gap-2">
              <span className="font-semibold text-ink-900">
                {b.name}
                {b.id === budget.id ? " · active" : ""}
              </span>
              <span className="text-ink-600">{b.role}</span>
            </li>
          ))}
        </ul>
        <form action={createBudgetAction} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="New budget name"
            className="flex-1 rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
          />
          <button
            type="submit"
            className="rounded-xl bg-ink-900 px-3 py-2 text-sm font-bold text-sand-50"
          >
            Create
          </button>
        </form>
      </section>

      {canAdmin ? (
        <section className="mt-4 space-y-3 rounded-3xl bg-sand-50/80 p-4 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-900">Rename budget</h2>
          <form action={renameBudgetAction} className="flex gap-2">
            <input
              name="name"
              defaultValue={budget.name}
              className="flex-1 rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
            />
            <button
              type="submit"
              className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50"
            >
              Save
            </button>
          </form>
        </section>
      ) : null}

      <section className="mt-4 space-y-3 rounded-3xl bg-sand-50/80 p-4 shadow-soft">
        <h2 className="font-display text-lg font-bold text-ink-900">Members</h2>
        <ul className="divide-y divide-ink-900/5">
          {(memberRows ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-semibold text-ink-900">
                  {nameById.get(m.user_id) || m.user_id.slice(0, 8)}
                </p>
                <p className="text-xs text-ink-600">{m.role}</p>
              </div>
              {canAdmin && m.user_id !== user.id ? (
                <div className="flex gap-2">
                  <form action={updateMemberRoleAction} className="flex gap-1">
                    <input type="hidden" name="member_id" value={m.id} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      className="rounded-lg border border-ink-900/10 bg-white px-2 py-1 text-xs"
                    >
                      <option value="viewer">viewer</option>
                      <option value="editor">editor</option>
                      <option value="admin">admin</option>
                      <option value="owner">owner</option>
                    </select>
                    <button type="submit" className="text-xs font-bold text-moss-500">
                      Update
                    </button>
                  </form>
                  <form action={removeMemberAction}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <button type="submit" className="text-xs font-bold text-coral-500">
                      Remove
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canAdmin ? (
        <section className="mt-4 space-y-4 rounded-3xl bg-sand-50/80 p-4 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-900">Invite links</h2>
          <form action={createInviteLinkAction} className="space-y-2">
            <input type="hidden" name="kind" value="shared" />
            <button
              type="submit"
              className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50"
            >
              Generate shared budget link
            </button>
            <p className="text-xs text-ink-600">Joins as editor.</p>
          </form>
          <form action={createInviteLinkAction} className="space-y-2 border-t border-ink-900/5 pt-4">
            <input type="hidden" name="kind" value="role" />
            <label className="block text-sm font-semibold text-ink-700">
              Role invite
              <select
                name="role"
                defaultValue="editor"
                className="mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm"
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </label>
            <button
              type="submit"
              className="w-full rounded-2xl bg-moss-500 px-4 py-3 text-sm font-bold text-sand-50"
            >
              Generate role invite link
            </button>
          </form>
          <ul className="space-y-2 border-t border-ink-900/5 pt-4 text-xs text-ink-600">
            {(invites ?? []).map((invite) => (
              <li key={String(invite.id)} className="flex items-center justify-between gap-2">
                <span>
                  {String(invite.kind)}
                  {invite.role ? `/${String(invite.role)}` : ""} · uses {String(invite.uses)}
                  {invite.max_uses != null ? `/${String(invite.max_uses)}` : ""}
                  {invite.revoked_at ? " · revoked" : ""}
                </span>
                {!invite.revoked_at ? (
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="invite_id" value={String(invite.id)} />
                    <button type="submit" className="font-bold text-coral-500">
                      Revoke
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canAdmin ? (
        <section className="mt-4 space-y-3 rounded-3xl bg-sand-50/80 p-4 shadow-soft">
          <h2 className="font-display text-lg font-bold text-ink-900">Bank sync (Teller)</h2>
          <p className="text-xs text-ink-600">
            Uses Teller <span className="font-semibold">Development</span> (free, ≤100
            enrollments). Not for unlimited public production without KYB. Daily Vercel Cron
            syncs when <code className="font-mono">CRON_SECRET</code> is set (Pro can run
            morning + evening).
          </p>
          {tellerReady && tellerAppId ? (
            <TellerConnectButton applicationId={tellerAppId} environment={tellerEnv} />
          ) : (
            <p className="rounded-xl bg-amber-100/80 px-3 py-2 text-xs text-amber-950">
              Teller is not fully configured. Add{" "}
              <code className="font-mono">NEXT_PUBLIC_TELLER_APPLICATION_ID</code>,{" "}
              <code className="font-mono">TELLER_CERTIFICATE</code>,{" "}
              <code className="font-mono">TELLER_PRIVATE_KEY</code>, and{" "}
              <code className="font-mono">CRON_SECRET</code> in Doppler.
            </p>
          )}

          {lastSync ? (
            <p className="text-xs text-ink-600">
              Last sync ({String(lastSync.source)}):{" "}
              {lastSync.finished_at
                ? new Date(String(lastSync.finished_at)).toLocaleString()
                : "in progress"}{" "}
              · +{String(lastSync.inserted)} / ~{String(lastSync.updated)}
              {lastSync.errors ? (
                <span className="mt-1 block text-coral-500">{String(lastSync.errors)}</span>
              ) : null}
            </p>
          ) : null}

          <ul className="divide-y divide-ink-900/5">
            {(enrollments ?? []).map((e) => (
              <li key={String(e.id)} className="space-y-2 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink-900">
                      {String(e.institution_name || "Bank")}
                    </p>
                    <p className="text-xs text-ink-600">
                      {String(e.status)}
                      {e.last_synced_at
                        ? ` · synced ${new Date(String(e.last_synced_at)).toLocaleString()}`
                        : " · never synced"}
                    </p>
                    {e.last_error ? (
                      <p className="text-xs text-coral-500">{String(e.last_error)}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <form action={syncTellerNowAction}>
                      <input type="hidden" name="enrollment_id" value={String(e.id)} />
                      <button type="submit" className="text-xs font-bold text-moss-500">
                        Sync now
                      </button>
                    </form>
                    <form action={disconnectTellerEnrollmentAction}>
                      <input type="hidden" name="enrollment_id" value={String(e.id)} />
                      <button type="submit" className="text-xs font-bold text-coral-500">
                        Disconnect
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4 rounded-3xl border border-coral-400/30 bg-coral-400/10 p-4">
        <h2 className="font-display text-lg font-bold text-ink-900">Leave budget</h2>
        <form action={leaveBudgetAction} className="mt-3">
          <button
            type="submit"
            className="rounded-xl bg-coral-500 px-4 py-2 text-sm font-bold text-sand-50"
          >
            Leave “{budget.name}”
          </button>
        </form>
      </section>
    </AppShell>
  );
}
