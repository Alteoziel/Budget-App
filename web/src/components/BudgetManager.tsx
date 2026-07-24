"use client";

import { useMemo, useState } from "react";
import { CategoryAssignControl } from "@/components/CategoryAssignControl";
import { CategoryGoalButton } from "@/components/CategoryGoalButton";
import { Money } from "@/components/Money";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import {
  deleteCategoryAction,
  deleteCategoryGroupAction,
  renameCategoryAction,
  renameCategoryGroupAction,
  reorderCategoryAction,
  reorderCategoryGroupAction,
} from "@/lib/actions";
import { formatCents } from "@/lib/money";
import type { BudgetRow } from "@/lib/types";

type GroupBlock = {
  groupId: string;
  groupName: string;
  categories: BudgetRow[];
};

const moveBtnClass =
  "min-h-11 min-w-11 rounded-xl border border-ink-900/10 bg-white px-2 text-sm font-bold text-ink-800 disabled:cursor-not-allowed disabled:opacity-35";

function MoveButtons({
  action,
  idName,
  idValue,
  canUp,
  canDown,
}: {
  action: (formData: FormData) => void | Promise<void>;
  idName: string;
  idValue: string;
  canUp: boolean;
  canDown: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <form action={action}>
        <input type="hidden" name={idName} value={idValue} />
        <input type="hidden" name="direction" value="up" />
        <PendingSubmitButton
          pendingLabel="…"
          disabled={!canUp}
          className={moveBtnClass}
          aria-label="Move up"
        >
          ↑
        </PendingSubmitButton>
      </form>
      <form action={action}>
        <input type="hidden" name={idName} value={idValue} />
        <input type="hidden" name="direction" value="down" />
        <PendingSubmitButton
          pendingLabel="…"
          disabled={!canDown}
          className={moveBtnClass}
          aria-label="Move down"
        >
          ↓
        </PendingSubmitButton>
      </form>
    </div>
  );
}

export function BudgetManager({
  month,
  groups,
}: {
  month: string;
  groups: GroupBlock[];
}) {
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );

  const allRows = useMemo(() => groups.flatMap((g) => g.categories), [groups]);
  const percentTotal = allRows
    .filter((row) => row.assignMode !== "fixed")
    .reduce((sum, row) => sum + (row.assignPercent || 0), 0);
  const fixedTotal = allRows
    .filter((row) => row.assignMode === "fixed")
    .reduce((sum, row) => sum + (row.assignFixedCents || 0), 0);

  if (groups.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-900/15 bg-sand-50/70 px-4 py-8 text-center">
        <p className="font-display text-xl font-bold text-ink-900">No categories yet</p>
        <p className="mt-2 text-sm text-ink-600">
          Add a category below, or import your YNAB CSV.
        </p>
      </div>
    );
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-600">
        Auto-assign shares:{" "}
        <span
          className={percentTotal > 100 ? "font-bold text-coral-500" : "font-bold text-ink-800"}
        >
          {percentTotal.toFixed(1)}%
        </span>
        {fixedTotal > 0 ? (
          <>
            {" "}
            +{" "}
            <span className="font-bold text-ink-800">{formatCents(fixedTotal)}</span>
          </>
        ) : null}{" "}
        of Ready to Assign
      </p>
      {groups.map((group, groupIndex) => {
        const collapsed = collapsedGroupIds.has(group.groupId);
        return (
          <div
            key={group.groupId}
            className="overflow-hidden rounded-3xl bg-sand-50/80 shadow-soft"
          >
            <div className="border-b border-ink-900/5 px-4 py-3">
              {editingGroupId === group.groupId ? (
                <form
                  action={renameCategoryGroupAction}
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={() => setEditingGroupId(null)}
                >
                  <input type="hidden" name="group_id" value={group.groupId} />
                  <label className="min-w-[12rem] flex-1 text-xs font-semibold text-ink-600">
                    Group name
                    <input
                      name="name"
                      required
                      defaultValue={group.groupName}
                      className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm font-bold text-ink-900 outline-none ring-moss-400 focus:ring-2"
                    />
                  </label>
                  <PendingSubmitButton
                    pendingLabel="Saving…"
                    className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50"
                  >
                    Save
                  </PendingSubmitButton>
                  <button
                    type="button"
                    onClick={() => setEditingGroupId(null)}
                    className="min-h-11 touch-manipulation rounded-xl px-3 py-2 text-sm font-semibold text-ink-600"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() => toggleGroup(group.groupId)}
                      className="min-w-0 flex-1 touch-manipulation rounded-xl py-1 text-left outline-none ring-moss-400 focus-visible:ring-2"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`text-ink-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
                        >
                          ▾
                        </span>
                        <h2 className="font-display text-lg font-bold text-ink-900">
                          {group.groupName}
                        </h2>
                      </span>
                      <span className="mt-0.5 block pl-6 text-xs text-ink-600">
                        {group.categories.length} categor
                        {group.categories.length === 1 ? "y" : "ies"}
                        {collapsed ? " · collapsed" : ""}
                      </span>
                    </button>
                    <MoveButtons
                      action={reorderCategoryGroupAction}
                      idName="group_id"
                      idValue={group.groupId}
                      canUp={groupIndex > 0}
                      canDown={groupIndex < groups.length - 1}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 pl-6">
                    <button
                      type="button"
                      onClick={() => setEditingGroupId(group.groupId)}
                      className="min-h-11 touch-manipulation px-2 text-sm font-bold text-moss-500"
                    >
                      Rename
                    </button>
                    <form action={deleteCategoryGroupAction}>
                      <input type="hidden" name="group_id" value={group.groupId} />
                      <PendingSubmitButton
                        pendingLabel="…"
                        className="min-h-11 px-2 text-sm font-bold text-coral-500"
                        onClick={(event) => {
                          if (
                            !confirm(
                              `Delete group “${group.groupName}” and all ${group.categories.length} categories in it? Transactions stay, but become uncategorized.`,
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        Delete
                      </PendingSubmitButton>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {!collapsed ? (
              <ul className="divide-y divide-ink-900/5">
                {group.categories.map((row, categoryIndex) => (
                  <li
                    key={row.categoryId}
                    className={`px-4 py-3 ${
                      row.availableCents < 0
                        ? "border-l-4 border-coral-500 bg-coral-400/10"
                        : ""
                    }`}
                  >
                    {editingCategoryId === row.categoryId ? (
                      <form
                        action={renameCategoryAction}
                        className="space-y-3"
                        onSubmit={() => setEditingCategoryId(null)}
                      >
                        <input type="hidden" name="category_id" value={row.categoryId} />
                        <label className="block text-xs font-semibold text-ink-600">
                          Category name
                          <input
                            name="name"
                            required
                            defaultValue={row.categoryName}
                            className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                          />
                        </label>
                        <div className="flex gap-2">
                          <PendingSubmitButton
                            pendingLabel="Saving…"
                            className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50"
                          >
                            Save name
                          </PendingSubmitButton>
                          <button
                            type="button"
                            onClick={() => setEditingCategoryId(null)}
                            className="min-h-11 touch-manipulation rounded-xl px-3 py-2 text-sm font-semibold text-ink-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink-900">{row.categoryName}</p>
                            <CategoryGoalButton row={row} />
                          </div>
                          <div className="flex shrink-0 items-start gap-2">
                            <div className="text-right">
                              <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">
                                Available
                              </p>
                              <p className="font-bold">
                                <Money cents={row.availableCents} />
                              </p>
                              {row.availableCents < 0 ? (
                                <p className="text-[11px] font-bold uppercase tracking-wide text-coral-500">
                                  Overspent
                                </p>
                              ) : null}
                            </div>
                            <MoveButtons
                              action={reorderCategoryAction}
                              idName="category_id"
                              idValue={row.categoryId}
                              canUp={categoryIndex > 0}
                              canDown={categoryIndex < group.categories.length - 1}
                            />
                          </div>
                        </div>
                        <div className="mt-2 flex gap-3">
                          <button
                            type="button"
                            onClick={() => setEditingCategoryId(row.categoryId)}
                            className="min-h-11 touch-manipulation px-1 text-sm font-bold text-moss-500"
                          >
                            Rename
                          </button>
                          <form action={deleteCategoryAction}>
                            <input type="hidden" name="category_id" value={row.categoryId} />
                            <PendingSubmitButton
                              pendingLabel="…"
                              className="min-h-11 px-1 text-sm font-bold text-coral-500"
                              onClick={(event) => {
                                if (
                                  !confirm(
                                    `Delete category “${row.categoryName}”? Its transactions become uncategorized.`,
                                  )
                                ) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              Delete
                            </PendingSubmitButton>
                          </form>
                        </div>
                      </>
                    )}

                    <CategoryAssignControl month={month} row={row} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
