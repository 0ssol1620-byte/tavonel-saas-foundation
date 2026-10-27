/*
  Home's first screen takes a PDF (founder ask 2026-10-27, "pdf 어디에 올리라는거야?"). The workspace
  intake is behind sign-in, so the dropped files wait in this browser's IndexedDB -- the same origin,
  so they survive the /login?next=/workspace round trip -- and nowhere else. Nothing is uploaded here.

  The workspace takes the record once its source access is known and hands the files to the same
  `stageWorkspaceFiles` a drop on its own intake uses (lib/workspace-intake): staging only, behind the
  intake-closed guard, with every upload still behind its own explicit approval. Taking it deletes it,
  whatever happens next, and a record older than HOME_DROP_TTL_MS is discarded unread.
  ponytail: an abandoned drop stays in this browser until the next /workspace visit or a site-data
  clear; a sweep on Home load is the upgrade if that matters.
*/
const DB = "tavonel-home-drop";
const STORE = "drops";
const KEY = "pending";
export const HOME_DROP_TTL_MS = 30 * 60_000;

type HomeDropRecord = { files: File[]; at: number };

function withStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  });
}

/** The files a record may still hand over at `now`; none once it is older than the TTL. */
export function freshHomeDrop(record: HomeDropRecord | undefined, now: number): File[] {
  return record && now - record.at <= HOME_DROP_TTL_MS ? record.files : [];
}

export async function stashHomeDrop(files: File[]) {
  await withStore("readwrite", store => store.put({ files, at: Date.now() } satisfies HomeDropRecord, KEY));
}

export async function takeHomeDrop(): Promise<File[]> {
  const record = await withStore<HomeDropRecord | undefined>("readonly", store => store.get(KEY));
  if (!record) return [];
  await withStore("readwrite", store => store.delete(KEY));
  return freshHomeDrop(record, Date.now());
}
