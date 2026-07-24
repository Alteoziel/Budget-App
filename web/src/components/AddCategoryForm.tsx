"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCategoryAction, createCategoryGroupAction } from "@/lib/actions";

export function AddCategoryForm({
  groups,
}: {
  groups: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [creatingGroup, setCreatingGroup] = useState(groups.length === 0);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setGroupError("Enter a group name.");
      return;
    }
    setGroupError(null);
    startTransition(async () => {
      const result = await createCategoryGroupAction(name);
      if (!result.ok) {
        setGroupError(result.error);
        return;
      }
      setGroupId(result.id);
      setNewGroupName("");
      setCreatingGroup(false);
      router.refresh();
    });
  }

  return (
    <form action={createCategoryAction} className="mt-3 space-y-3">
      <div className="text-sm font-semibold text-ink-700">
        Group
        <div className="mt-1 flex items-end gap-2">
          {creatingGroup ? (
            <>
              <input
                aria-label="New group name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="New group name"
                className="min-h-11 flex-1 touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              />
              <button
                type="button"
                onClick={addGroup}
                disabled={pending}
                className="min-h-11 shrink-0 touch-manipulation rounded-xl bg-moss-500 px-3 py-3 text-sm font-bold text-sand-50 disabled:opacity-60"
              >
                {pending ? "Adding…" : "Add"}
              </button>
              {groups.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingGroup(false);
                    setGroupError(null);
                  }}
                  className="min-h-11 shrink-0 touch-manipulation px-2 text-sm font-semibold text-ink-600"
                >
                  Cancel
                </button>
              ) : null}
            </>
          ) : (
            <>
              <select
                name="group_id"
                aria-label="Group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="min-h-11 flex-1 touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreatingGroup(true)}
                title="New group"
                aria-label="New group"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-ink-900/10 bg-white text-lg font-bold text-moss-500"
              >
                +
              </button>
            </>
          )}
        </div>
        {groupError ? (
          <p className="mt-1 text-xs font-semibold text-coral-500">{groupError}</p>
        ) : null}
      </div>

      <label className="block text-sm font-semibold text-ink-700">
        Category
        <input
          required
          name="category_name"
          placeholder="Groceries"
          className="mt-1 min-h-11 w-full touch-manipulation rounded-xl border border-ink-900/10 bg-white px-3 py-3 outline-none ring-moss-400 focus:ring-2"
        />
      </label>

      <button
        type="submit"
        disabled={creatingGroup || !groupId}
        className="w-full rounded-2xl bg-ink-900 px-4 py-3 text-sm font-bold text-sand-50 hover:bg-ink-800 disabled:opacity-50"
      >
        Add category
      </button>
      {creatingGroup ? (
        <p className="text-xs text-ink-600">
          Add the new group first, then you can save the category into it.
        </p>
      ) : null}
    </form>
  );
}
