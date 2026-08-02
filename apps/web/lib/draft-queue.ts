import { openDB } from "idb";

import { saveAttemptResponse } from "@/lib/api-client";

export type DraftSyncRequest = {
  attemptId: string;
  questionId: string;
  payload: {
    kind: "choice" | "text" | "tokens" | "strokes" | "photo";
    answer: Record<string, unknown>;
    expected_version: number;
  };
};

export type PendingDraft = {
  key: string;
  answer: unknown;
  syncRequest?: DraftSyncRequest;
  savedAt: string;
  expiresAt: string;
};

const DATABASE_NAME = "luma-private-drafts";
const STORE_NAME = "pending";

async function database() {
  return openDB(DATABASE_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    },
  });
}

export async function savePendingDraft(
  key: string,
  answer: unknown,
  syncRequest?: DraftSyncRequest,
): Promise<void> {
  const db = await database();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await db.put(STORE_NAME, {
    key,
    answer,
    syncRequest,
    savedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  } satisfies PendingDraft);
}

export async function syncPendingDrafts(
  childToken: string,
  now = new Date(),
): Promise<number> {
  const db = await database();
  const drafts = (await db.getAll(STORE_NAME)) as PendingDraft[];
  let synced = 0;
  for (const draft of drafts) {
    if (new Date(draft.expiresAt) <= now) {
      await db.delete(STORE_NAME, draft.key);
      continue;
    }
    if (!draft.syncRequest) {
      continue;
    }
    try {
      await saveAttemptResponse(
        draft.syncRequest.attemptId,
        draft.syncRequest.questionId,
        draft.syncRequest.payload,
        childToken,
      );
      await db.delete(STORE_NAME, draft.key);
      synced += 1;
    } catch {
      // Keep the draft for the next online retry or explicit conflict handling.
    }
  }
  return synced;
}

export async function removePendingDraft(key: string): Promise<void> {
  const db = await database();
  await db.delete(STORE_NAME, key);
}

export async function getPendingDraftsByPrefix(
  prefix: string,
  now = new Date(),
): Promise<PendingDraft[]> {
  const db = await database();
  const drafts = (await db.getAll(STORE_NAME)) as PendingDraft[];
  return drafts
    .filter(
      (draft) =>
        draft.key.startsWith(prefix) && new Date(draft.expiresAt) > now,
    )
    .sort((left, right) => left.savedAt.localeCompare(right.savedAt));
}

export async function removePendingDraftsByPrefix(prefix: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    const draft = cursor.value as PendingDraft;
    if (draft.key.startsWith(prefix)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
}

export async function clearPendingDrafts(): Promise<void> {
  const db = await database();
  await db.clear(STORE_NAME);
}

export async function purgeExpiredDrafts(now = new Date()): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    const draft = cursor.value as PendingDraft;
    if (new Date(draft.expiresAt) <= now) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
}
