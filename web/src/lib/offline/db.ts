"use client";

import type { OfflineOutboxItem, OfflineSnapshot } from "@/lib/offline/types";

const DB_NAME = "alte-offline";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const OUTBOX_STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  const db = await openDb();
  try {
    await reqToPromise(
      db.transaction(SNAPSHOT_STORE, "readwrite").objectStore(SNAPSHOT_STORE).put(snapshot, "latest"),
    );
  } finally {
    db.close();
  }
}

export async function readOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  const db = await openDb();
  try {
    const value = await reqToPromise(
      db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).get("latest"),
    );
    return (value as OfflineSnapshot | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function enqueueOutboxItem(
  item: Omit<OfflineOutboxItem, "id" | "createdAt">,
): Promise<OfflineOutboxItem> {
  const full: OfflineOutboxItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const db = await openDb();
  try {
    await reqToPromise(
      db.transaction(OUTBOX_STORE, "readwrite").objectStore(OUTBOX_STORE).put(full),
    );
  } finally {
    db.close();
  }
  return full;
}

export async function listOutbox(): Promise<OfflineOutboxItem[]> {
  const db = await openDb();
  try {
    const rows = await reqToPromise(
      db.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll(),
    );
    return ((rows as OfflineOutboxItem[]) ?? []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  } finally {
    db.close();
  }
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await openDb();
  try {
    await reqToPromise(
      db.transaction(OUTBOX_STORE, "readwrite").objectStore(OUTBOX_STORE).delete(id),
    );
  } finally {
    db.close();
  }
}
