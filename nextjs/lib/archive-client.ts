import {
  type ArchiveEntry,
  expandArchive,
  MAX_SYNC_ARCHIVE_BYTES,
  MAX_WORKER_ARCHIVE_BYTES,
} from "./archive-expand";
import type { ArchiveWorkerResponse } from "./archive-worker";

/*
  Choosing where an archive is expanded, and admitting when the choice is the slow one.

  A worker is not always available: an old browser, a policy that blocks worker construction,
  a server render. The fallback runs the same code on the main thread with the same guards --
  what it cannot do is stay responsive, so the ceiling falls back with it. Offering the larger
  limit and then freezing the tab would be worse than not offering it.
*/

export type ArchiveExpansion = {
  entries: ArchiveEntry[];
  /** Where it ran, so the caller can explain a refusal in terms the customer can act on. */
  mode: "worker" | "main-thread";
};

export type ArchiveExpander = {
  ceilingBytes: number;
  mode: "worker" | "main-thread";
  expand: (file: File, options?: {
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  }) => Promise<ArchiveExpansion>;
  close: () => void;
};

function mainThreadExpander(): ArchiveExpander {
  return {
    ceilingBytes: MAX_SYNC_ARCHIVE_BYTES,
    mode: "main-thread",
    async expand(file, options) {
      if (file.size > MAX_SYNC_ARCHIVE_BYTES) throw new Error("ARCHIVE_TOO_LARGE");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = expandArchive(bytes, {
        onProgress: options?.onProgress,
        isCancelled: () => options?.signal?.aborted === true,
      });
      return { entries, mode: "main-thread" };
    },
    close() { /* nothing to tear down */ },
  };
}

/**
 * A worker-backed expander, falling back to the main thread when one cannot be constructed.
 *
 * The worker is created lazily and torn down by `close`, because it holds the archive and its
 * expansion in memory and a workspace that stages several selections in a row should not
 * accumulate them.
 */
export function createArchiveExpander(): ArchiveExpander {
  if (typeof Worker === "undefined") return mainThreadExpander();

  let worker: Worker;
  try {
    worker = new Worker(new URL("./archive-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return mainThreadExpander();
  }

  let nextId = 1;
  return {
    ceilingBytes: MAX_WORKER_ARCHIVE_BYTES,
    mode: "worker",
    expand(file, options) {
      if (file.size > MAX_WORKER_ARCHIVE_BYTES) return Promise.reject(new Error("ARCHIVE_TOO_LARGE"));
      const id = nextId;
      nextId += 1;

      return new Promise<ArchiveExpansion>((resolve, reject) => {
        const onAbort = () => worker.postMessage({ type: "cancel", id });
        const cleanup = () => {
          worker.removeEventListener("message", onMessage);
          options?.signal?.removeEventListener("abort", onAbort);
        };
        const onMessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
          const message = event.data;
          if (message.id !== id) return;
          if (message.type === "progress") {
            options?.onProgress?.(message.done, message.total);
            return;
          }
          cleanup();
          if (message.type === "error") {
            reject(new Error(message.reason));
            return;
          }
          resolve({
            mode: "worker",
            entries: message.entries.map((entry) => ({ path: entry.path, bytes: new Uint8Array(entry.bytes) })),
          });
        };

        worker.addEventListener("message", onMessage);
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        void file.arrayBuffer().then(
          (buffer) => worker.postMessage({ type: "expand", id, bytes: buffer }, [buffer]),
          (error: unknown) => {
            cleanup();
            reject(error instanceof Error ? error : new Error("ARCHIVE_READ_FAILED"));
          },
        );
      });
    },
    close() { worker.terminate(); },
  };
}
