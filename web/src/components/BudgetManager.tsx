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
  "min-h-9 min-w-9 rounded-lg border border-ink-900/15 bg-sand-50 px-1.5 text-xs font-bold text-ink-700 disabled:cursor-not-allowed disabled:opacity-30";

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
  collapsedGroupIds,
  onCollapsedGroupIdsChange,
}: {
  month: string;
  groups: GroupBlock[];
  collapsedGroupIds: Set<string>;
  onCollapsedGroupIdsChange: (next: Set<string>) => void;
}) {
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  const allRows = useMemo(() => groups.flatMap((g) => g.categories), [groups]);
  const percentTotal = allRows
    .filter((row) => row.assignMode !== "fixed")
    .reduce((sum, row) => sum + (row.assignPercent || 0), 0);
  const fixedTotal = allRows
    .filter((row) => row.assignMode === "fixed")
    .reduce((sum, row) => sum + (row.assignFixedCents || 0), 0);

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-900/20 bg-sand-50 px-4 py-8 text-center">
        <p className="font-display text-xl font-bold text-ink-900">No categories yet</p>
        <p className="mt-2 text-sm text-ink-600">
          Add a category below, or import your YNAB CSV.
        </p>
      </div>
    );
  }

  function toggleGroup(groupId: string) {
    const next = new Set(collapsedGroupIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    onCollapsedGroupIdsChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-ink-600">
        Auto-assign:{" "}
        <span
          className={percentTotal > 100 ? "font-bold text-coral-500" : "font-bold text-ink-800"}
        >
          {percentTotal.toFixed(1)}%
        </span>
        {fixedTotal > 0 ? (
          <>
            {" + "}
            <span className="font-bold text-ink-800">{formatCents(fixedTotal)}</span>
          </>
        ) : null}{" "}
        of Ready to Assign
      </p>

      {groups.map((group, groupIndex) => {
        const collapsed = collapsedGroupIds.has(group.groupId);
        const groupAvailable = group.categories.reduce(
          (sum, row) => sum + row.availableCents,
          0,
        );
        return (
          <section
            key={group.groupId}
            className="card-surface overflow-hidden rounded-2xl"
          >
            <div className="card-header px-3 py-2.5">
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
                      className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/15 bg-white px-3 py-2 text-sm font-bold text-ink-900 outline-none ring-moss-400 focus:ring-2"
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() => toggleGroup(group.groupId)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl text-left outline-none ring-moss-400 focus-visible:ring-2"
                  >
                    <span
                      aria-hidden
                      className={`text-xs text-ink-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
                    >
                      ▾
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-base font-bold uppercase tracking-wide text-ink-900">
                        {group.groupName}
                      </span>
                      <span className="block text-[11px] font-semibold text-ink-500">
                        {group.categories.length} categor
                        {group.categories.length === 1 ? "y" : "ies"} ·{" "}
                        {formatCents(groupAvailable)} available
                      </span>
                    </span>
                  </button>

                  <MoveButtons
                    action={reorderCategoryGroupAction}
                    idName="group_id"
                    idValue={group.groupId}
                    canUp={groupIndex > 0}
                    canDown={groupIndex < groups.length - 1}
                  />
                  <button
                    type="button"
                    onClick={() => setEditingGroupId(group.groupId)}
                    className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-bold text-moss-500"
                  >
                    Edit
                  </button>
                  <form action={deleteCategoryGroupAction} className="shrink-0">
                    <input type="hidden" name="group_id" value={group.groupId} />
                    <PendingSubmitButton
                      pendingLabel="…"
                      className="min-h-9 rounded-lg px-2 text-xs font-bold text-coral-500"
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
              )}
            </div>

            {!collapsed ? (
              <ul className="row-divide">
                {group.categories.map((row, categoryIndex) => {
                  const expanded = expandedCategoryId === row.categoryId;
                  return (
                    <li
                      key={row.categoryId}
                      className={`px-3 py-2.5 ${
                        row.availableCents < 0
                          ? "border-l-[3px] border-l-coral-500 bg-coral-400/10"
                          : ""
                      }`}
                    >
                      {editingCategoryId === row.categoryId ? (
                        <form
                          action={renameCategoryAction}
                          className="space-y-2"
                          onSubmit={() => setEditingCategoryId(null)}
                        >
                          <input type="hidden" name="category_id" value={row.categoryId} />
                          <label className="block text-xs font-semibold text-ink-600">
                            Category name
                            <input
                              name="name"
                              required
                              defaultValue={row.categoryName}
                              className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/15 bg-white px-3 py-2 text-sm outline-none ring-moss-400 focus:ring-2"
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
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} assign controls for ${row.categoryName}`}
                            onClick={() =>
                              setExpandedCategoryId(expanded ? null : row.categoryId)
                            }
                            className="flex min-h-11 w-full items-center gap-2 rounded-xl text-left outline-none ring-moss-400 focus-visible:ring-2"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-bold text-ink-900">
                                {row.categoryName}
                              </span>
                              <span className="block truncate text-[11px] font-semibold text-ink-500">
                                Assigned {formatCents(row.assignedCents)}
                                {row.assignMode === "fixed" && row.assignFixedCents > 0
                                  ? ` · auto ${formatCents(row.assignFixedCents)}`
                                  : row.assignMode !== "fixed" && row.assignPercent > 0
                                    ? ` · auto ${row.assignPercent.toFixed(1)}%`
                                    : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[15px] font-bold leading-tight">
                                <Money cents={row.availableCents} />
                              </span>
                              <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-500">
                                {row.availableCents < 0 ? "Overspent" : "Available"}
                              </span>
                            </span>
                            <span
                              aria-hidden
                              className={`shrink-0 text-xs text-ink-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                            >
                              ▾
                            </span>
                          </button>

                          {expanded ? (
                            <>
                              <CategoryAssignControl month={month} row={row} />
                              <div className="mt-2 flex items-center gap-2">
                                <MoveButtons
                                  action={reorderCategoryAction}
                                  idName="category_id"
                                  idValue={row.categoryId}
                                  canUp={categoryIndex > 0}
                                  canDown={categoryIndex < group.categories.length - 1}
                                />
                                <button
                                  type="button"
                                  onClick={() => setEditingCategoryId(row.categoryId)}
                                  className="min-h-9 rounded-lg px-2 text-xs font-bold text-moss-500"
                                >
                                  Rename
                                </button>
                                <form action={deleteCategoryAction}>
                                  <input
                                    type="hidden"
                                    name="category_id"
                                    value={row.categoryId}
                                  />
                                  <PendingSubmitButton
                                    pendingLabel="…"
                                    className="min-h-9 rounded-lg px-2 text-xs font-bold text-coral-500"
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
                          ) : null}

                          <CategoryGoalButton
                            row={row}
                            onExpandClick={() =>
                              setExpandedCategoryId(expanded ? null : row.categoryId)
                            }
                          />
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
