"use client";

import type { OfflineOutboxItem, OfflineSnapshot } from "@/lib/offline/types";

const DB_NAME = "alte-offline";
const DB_VERSION = 2;
const SNAPSHOT_STORE = "snapshots";
const OUTBOX_STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // v1 used global keys, so it could expose one user's data to another.
      if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        if (db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.deleteObjectStore(SNAPSHOT_STORE);
        }
        if (db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.deleteObjectStore(OUTBOX_STORE);
        }
      }
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
      db
        .transaction(SNAPSHOT_STORE, "readwrite")
        .objectStore(SNAPSHOT_STORE)
        .put(snapshot, `${snapshot.ownerUserId}:${snapshot.budget.id}`),
    );
  } finally {
    db.close();
  }
}

export async function readOfflineSnapshot(
  ownerUserId: string,
  budgetId: string,
): Promise<OfflineSnapshot | null> {
  const db = await openDb();
  try {
    const value = await reqToPromise(
      db
        .transaction(SNAPSHOT_STORE, "readonly")
        .objectStore(SNAPSHOT_STORE)
        .get(`${ownerUserId}:${budgetId}`),
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

export async function listOutbox(
  ownerUserId: string,
  budgetId: string,
): Promise<OfflineOutboxItem[]> {
  const db = await openDb();
  try {
    const rows = await reqToPromise(
      db.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll(),
    );
    return ((rows as OfflineOutboxItem[]) ?? [])
      .filter(
        (row) =>
          row.ownerUserId === ownerUserId && row.budgetId === budgetId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

export async function purgePrivateOfflineData(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(
          (key) =>
            key.startsWith("alte-pages-") || key.startsWith("alte-data-"),
        )
        .map((key) => caches.delete(key)),
    );
  }
  navigator.serviceWorker?.controller?.postMessage("PURGE_PRIVATE_DATA");
}
