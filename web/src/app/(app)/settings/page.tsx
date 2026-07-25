import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { FlashError } from "@/components/FlashError";
import { ImportForm } from "@/components/ImportForm";
import { InstallGuide } from "@/components/InstallGuide";
import { InviteRoleLink } from "@/components/InviteRoleLink";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { ProfileSettings } from "@/components/ProfileSettings";
import { RecentChangesOverlay } from "@/components/RecentChangesOverlay";
import { SettingsCategory } from "@/components/SettingsCategory";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  createBudgetAction,
  deleteBudgetAction,
  deleteInviteAction,
  disconnectPlaidItemAction,
  leaveBudgetAction,
  removeMemberAction,
  renameBudgetAction,
  revokeInviteAction,
  signOutAction,
  switchBudgetAction,
  syncPlaidNowAction,
  updateMemberRoleAction,
} from "@/lib/actions";
import { listUserBudgets, requireBudget, roleAtLeast } from "@/lib/budget-context";
import { listRecentBudgetChanges } from "@/lib/change-log";
import { createClient } from "@/lib/supabase/server";
import { plaidConfigured, plaidEnvName } from "@/lib/plaid/client";

function SettingsCard({
  title,
  description,
  children,
  danger = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={
        danger
          ? "space-y-3 rounded-2xl border border-coral-500/35 bg-coral-400/10 p-4"
          : "card-surface space-y-3 rounded-2xl p-4"
      }
    >
      <div>
        <h3 className="font-display text-lg font-bold text-ink-900">{title}</h3>
        {description ? <p className="mt-1 text-xs text-ink-600">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    invite?: string;
    kind?: string;
    notice?: string;
    import?: string;
    changes?: string;
  }>;
}) {
  const params = await searchParams;
  const { budget, role, user } = await requireBudget("viewer");
  const budgets = await listUserBudgets();
  const supabase = await createClient();
  const canAdmin = roleAtLeast(role, "admin");
  const isOwner = role === "owner";
  const canEdit = roleAtLeast(role, "editor");
  const recentChanges = canEdit
    ? await listRecentBudgetChanges(supabase, budget.id)
    : [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

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

  const plaidReady = plaidConfigured();
  const plaidEnv = plaidEnvName();

  let plaidItems: Array<Record<string, unknown>> = [];
  let lastSync: Record<string, unknown> | null = null;
  if (canAdmin) {
    const itemsRes = await supabase
      .from("plaid_items")
      .select("id,institution_name,status,last_synced_at,last_error,created_at,item_id")
      .eq("budget_id", budget.id)
      .neq("status", "disconnected")
      .order("created_at", { ascending: false });
    if (!itemsRes.error) plaidItems = itemsRes.data ?? [];

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
      <FlashError message={params.notice} tone="success" />

      <SettingsCategory
        title="You"
        description="Your profile, appearance, and this device."
      >
        <SettingsCard title="Profile">
          <ProfileSettings
            email={user.email ?? ""}
            displayName={profile?.display_name || user.user_metadata?.display_name || ""}
          />
        </SettingsCard>

        <SettingsCard title="Appearance" description="Choose light, dark, or follow your device.">
          <ThemeToggle />
        </SettingsCard>

        <SettingsCard
          title="Auto-assign & AP"
          description="How Ready to assign can be spread across categories."
        >
          <ul className="space-y-2 text-sm text-ink-700">
            <li>
              <span className="font-bold text-ink-900">Regular</span> uses each
              category’s <span className="font-semibold">auto:%</span> and{" "}
              <span className="font-semibold">auto:#</span> rules.
            </li>
            <li>
              <span className="font-bold text-ink-900">Priority</span> funds
              categories in <span className="font-semibold">AP</span> order
              (Auto Priority). Lower numbers fill first; ties split evenly until
              each category’s goal is met — or its{" "}
              <span className="font-semibold">auto:#</span> amount if it has no
              goal.
            </li>
            <li>
              On Budget, expand a category, enter a whole number, and tap{" "}
              <span className="font-semibold">AP</span> (0 clears). Switch
              Regular / Priority next to Auto-assign.
            </li>
          </ul>
        </SettingsCard>

        <SettingsCard
          title="Install on iPhone"
          description="Use Alte' from your Home Screen, including offline."
        >
          <InstallGuide />
          <Link
            href="/offline"
            className="inline-flex min-h-11 items-center text-sm font-bold text-moss-500"
          >
            Open offline cache →
          </Link>
        </SettingsCard>

        <SettingsCard
          title="Sign out"
          description="End your session on this device."
        >
          <form action={signOutAction}>
            <PendingSubmitButton
              pendingLabel="Signing out…"
              className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-sand-50 hover:bg-ink-800"
            >
              Sign out
            </PendingSubmitButton>
          </form>
        </SettingsCard>
      </SettingsCategory>

      <SettingsCategory
        title="Budgets"
        description="Create, switch, and rename the budget you’re working in."
      >
        <SettingsCard
          title="Budgets manager"
          description="Create and switch budgets. Rename the active budget below."
        >
          <ul className="divide-y divide-ink-900/5">
            {budgets.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-ink-900">
                    {b.name}
                    {b.id === budget.id ? (
                      <span className="ml-2 text-xs font-bold text-moss-500">active</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-600">{b.role}</p>
                </div>
                {b.id !== budget.id ? (
                  <form action={switchBudgetAction}>
                    <input type="hidden" name="budget_id" value={b.id} />
                    <PendingSubmitButton
                      pendingLabel="Switching…"
                      className="rounded-xl bg-ink-900 px-3 py-2 text-xs font-bold text-sand-50"
                    >
                      Switch
                    </PendingSubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <form action={createBudgetAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              name="name"
              placeholder="New budget name"
              className="min-h-11 flex-1 touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
            />
            <PendingSubmitButton
              pendingLabel="Creating…"
              className="rounded-xl bg-ink-900 px-3 py-2 text-sm font-bold text-sand-50"
            >
              Create budget
            </PendingSubmitButton>
          </form>
        </SettingsCard>

        {canAdmin ? (
          <SettingsCard title="Rename active budget">
            <form action={renameBudgetAction} className="flex flex-col gap-2 sm:flex-row">
              <input
                name="name"
                defaultValue={budget.name}
                className="min-h-11 flex-1 touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
              />
              <PendingSubmitButton
                pendingLabel="Saving…"
                className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50"
              >
                Save
              </PendingSubmitButton>
            </form>
          </SettingsCard>
        ) : null}
      </SettingsCategory>

      <SettingsCategory
        title="People & access"
        description="Who can view or edit this budget, and how they join."
        defaultOpen={Boolean(
          params.invite ||
            params.changes ||
            params.notice ||
            (params.error && /invite|undo|change/i.test(params.error)),
        )}
      >
        {canEdit ? (
          <SettingsCard
            title="Recent changes"
            description="Review deletes, edits, and auto-assign runs from the last 7 days and undo mistakes. Older history is permanently removed."
          >
            <RecentChangesOverlay
              changes={recentChanges}
              defaultOpen={Boolean(params.changes)}
            />
          </SettingsCard>
        ) : null}

        <SettingsCard title="Members">
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
                  <div className="flex flex-wrap gap-2">
                    <form action={updateMemberRoleAction} className="flex gap-1">
                      <input type="hidden" name="member_id" value={m.id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        className="min-h-11 touch-manipulation rounded-lg border border-ink-900/10 bg-white px-2 py-1 text-xs"
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                        <option value="owner">owner</option>
                      </select>
                      <PendingSubmitButton
                        pendingLabel="…"
                        className="min-h-11 px-2 text-xs font-bold text-moss-500"
                      >
                        Update
                      </PendingSubmitButton>
                    </form>
                    <form action={removeMemberAction}>
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <PendingSubmitButton
                        pendingLabel="…"
                        className="min-h-11 px-2 text-xs font-bold text-coral-500"
                      >
                        Remove
                      </PendingSubmitButton>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </SettingsCard>

        {canAdmin ? (
          <SettingsCard
            title="Invite links"
            description="Create a role invite, revoke it when you’re done, then delete revoked links from history."
          >
            <InviteRoleLink />
            <ul className="space-y-2 border-t border-ink-900/5 pt-4 text-xs text-ink-600">
              {(invites ?? []).length === 0 ? (
                <li>No invite links yet.</li>
              ) : (
                (invites ?? []).map((invite) => {
                  const revoked = Boolean(invite.revoked_at);
                  return (
                    <li
                      key={String(invite.id)}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {String(invite.role || invite.kind)} · uses {String(invite.uses)}
                        {invite.max_uses != null
                          ? `/${String(invite.max_uses)}`
                          : " (unlimited)"}
                        {revoked ? " · revoked" : ""}
                        {invite.created_at
                          ? ` · ${new Date(String(invite.created_at)).toLocaleDateString()}`
                          : ""}
                      </span>
                      {revoked ? (
                        <form action={deleteInviteAction}>
                          <input type="hidden" name="invite_id" value={String(invite.id)} />
                          <PendingSubmitButton
                            pendingLabel="…"
                            className="min-h-11 font-bold text-coral-500"
                          >
                            Delete
                          </PendingSubmitButton>
                        </form>
                      ) : (
                        <form action={revokeInviteAction}>
                          <input type="hidden" name="invite_id" value={String(invite.id)} />
                          <PendingSubmitButton
                            pendingLabel="…"
                            className="min-h-11 font-bold text-coral-500"
                          >
                            Revoke
                          </PendingSubmitButton>
                        </form>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </SettingsCard>
        ) : null}
      </SettingsCategory>

      <SettingsCategory
        title="Import"
        description="Bring YNAB Reflect or register CSV exports into this budget."
        defaultOpen={Boolean(params.import)}
      >
        <SettingsCard
          title="YNAB import"
          description="Accounts and categories are created automatically. Assigned budget amounts stay at zero so you can set them in Budget."
        >
          <ImportForm />
        </SettingsCard>
        <SettingsCard title="Supported exports">
          <div className="space-y-2 text-sm text-ink-700">
            <p>
              <span className="font-semibold text-ink-900">Preferred:</span>{" "}
              YNAB Reflect → Income vs Expense CSV (
              <code className="rounded bg-sand-100 px-1.5 py-0.5 text-xs">
                Category, Jan 2025, …, Total
              </code>
              ).
            </p>
            <p>
              <span className="font-semibold text-ink-900">Also:</span> register
              CSV (
              <code className="rounded bg-sand-100 px-1.5 py-0.5 text-xs">
                Account, Date, Payee, Category Group/Category, Memo, Outflow,
                Inflow
              </code>
              ).
            </p>
          </div>
        </SettingsCard>
      </SettingsCategory>

      {canAdmin ? (
        <SettingsCategory
          title="Connections"
          description="Bank sync and other linked services for this budget."
        >
          <SettingsCard
            title="Bank sync (Plaid)"
            description={`Environment: ${plaidEnv}. Daily cron at 6:15 AM Mountain; if that misses, opening the app also catch-up syncs when the last sync is older than 16 hours.`}
          >
            {plaidReady ? (
              <PlaidLinkButton />
            ) : (
              <p className="rounded-xl bg-amber-100/80 px-3 py-2 text-xs text-amber-950">
                Plaid is not configured. Add{" "}
                <code className="font-mono">PLAID_CLIENT_ID</code>,{" "}
                <code className="font-mono">PLAID_SECRET</code>,{" "}
                <code className="font-mono">PLAID_ENV</code> (sandbox/development/production),{" "}
                <code className="font-mono">SUPABASE_SECRET_KEY</code>,{" "}
                <code className="font-mono">BANK_TOKEN_ENCRYPTION_KEY</code>, and{" "}
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
              {plaidItems.map((item) => (
                <li key={String(item.id)} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink-900">
                        {String(item.institution_name || "Bank")}
                      </p>
                      <p className="text-xs text-ink-600">
                        {String(item.status)}
                        {item.last_synced_at
                          ? ` · synced ${new Date(String(item.last_synced_at)).toLocaleString()}`
                          : " · never synced"}
                      </p>
                      {item.last_error ? (
                        <p className="text-xs text-coral-500">{String(item.last_error)}</p>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <form action={syncPlaidNowAction}>
                        <input type="hidden" name="item_id" value={String(item.id)} />
                        <PendingSubmitButton
                          pendingLabel="Syncing…"
                          className="min-h-11 text-xs font-bold text-moss-500"
                        >
                          Sync now
                        </PendingSubmitButton>
                      </form>
                      <form action={disconnectPlaidItemAction}>
                        <input type="hidden" name="item_id" value={String(item.id)} />
                        <PendingSubmitButton
                          pendingLabel="…"
                          className="min-h-11 text-xs font-bold text-coral-500"
                        >
                          Disconnect
                        </PendingSubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SettingsCard>
        </SettingsCategory>
      ) : null}

      <SettingsCategory
        title="Danger zone"
        description="Leaving or deleting a budget can’t be undone lightly."
      >
        <SettingsCard title="Leave budget" danger>
          <form action={leaveBudgetAction}>
            <PendingSubmitButton
              pendingLabel="Leaving…"
              className="rounded-xl bg-coral-500 px-4 py-2 text-sm font-bold text-sand-50"
            >
              Leave “{budget.name}”
            </PendingSubmitButton>
          </form>
        </SettingsCard>

        {isOwner ? (
          <SettingsCard
            title="Delete budget"
            description={`Permanently deletes “${budget.name}” and all of its data. Type the name to confirm.`}
            danger
          >
            <form action={deleteBudgetAction} className="space-y-2">
              <input
                name="confirm_name"
                placeholder={budget.name}
                className="min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
              />
              <PendingSubmitButton
                pendingLabel="Deleting…"
                className="rounded-xl bg-coral-500 px-4 py-2 text-sm font-bold text-sand-50"
              >
                Delete budget
              </PendingSubmitButton>
            </form>
          </SettingsCard>
        ) : null}
      </SettingsCategory>
    </AppShell>
  );
}
