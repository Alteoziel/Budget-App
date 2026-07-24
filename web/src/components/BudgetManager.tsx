"use client";

import { useState } from "react";
import { Money } from "@/components/Money";
import { PendingSubmitButton } from "@/components/PendingSubmitButton";
import {
  assignCategoryAction,
  deleteCategoryAction,
  deleteCategoryGroupAction,
  renameCategoryAction,
  renameCategoryGroupAction,
  setCategoryAssignPercentAction,
} from "@/lib/actions";
import type { BudgetRow } from "@/lib/types";

type GroupBlock = {
  groupId: string;
  groupName: string;
  categories: BudgetRow[];
};

export function BudgetManager({
  month,
  groups,
}: {
  month: string;
  groups: GroupBlock[];
}) {
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

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

  const percentTotal = groups
    .flatMap((g) => g.categories)
    .reduce((sum, row) => sum + (row.assignPercent || 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-600">
        Auto-assign shares:{" "}
        <span className={percentTotal > 100 ? "font-bold text-coral-500" : "font-bold text-ink-800"}>
          {percentTotal.toFixed(1)}%
        </span>{" "}
        of Ready to Assign
      </p>
      {groups.map((group) => (
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
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-ink-900">
                  {group.groupName}
                </h2>
                <div className="flex shrink-0 gap-2">
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

          <ul className="divide-y divide-ink-900/5">
            {group.categories.map((row) => (
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
                      <div>
                        <p className="font-semibold text-ink-900">{row.categoryName}</p>
                        <p className="mt-1 text-xs text-ink-600">
                          Activity <Money cents={row.activityCents} />
                        </p>
                      </div>
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

                <form
                  action={assignCategoryAction}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="category_id" value={row.categoryId} />
                  <input type="hidden" name="month" value={month} />
                  <label className="min-w-[7rem] flex-1 text-xs font-semibold text-ink-600">
                    Assigned
                    <input
                      name="assigned"
                      inputMode="decimal"
                      defaultValue={(row.assignedCents / 100).toFixed(2)}
                      className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                    />
                  </label>
                  <PendingSubmitButton
                    pendingLabel="Saving…"
                    className="rounded-xl bg-moss-500 px-3 py-2 text-sm font-bold text-sand-50 hover:bg-moss-400"
                  >
                    Save
                  </PendingSubmitButton>
                </form>

                <form
                  action={setCategoryAssignPercentAction}
                  className="mt-2 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="category_id" value={row.categoryId} />
                  <label className="min-w-[7rem] flex-1 text-xs font-semibold text-ink-600">
                    Auto-assign %
                    <input
                      name="assign_percent"
                      inputMode="decimal"
                      defaultValue={String(row.assignPercent || 0)}
                      className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
                    />
                  </label>
                  <PendingSubmitButton
                    pendingLabel="…"
                    className="rounded-xl border border-ink-900/10 bg-white px-3 py-2 text-sm font-bold text-ink-800"
                  >
                    Set %
                  </PendingSubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
