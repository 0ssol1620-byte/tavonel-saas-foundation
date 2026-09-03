/// <reference lib="webworker" />
import { expandArchive } from "./archive-expand";

/*
  Archive expansion, off the main thread.

  The worker exists for one reason: `unzipSync` cannot be interrupted, so wherever it runs
  nothing else runs. On the main thread that is the UI -- no repaint, no progress, no cancel
  button that can be pressed. Here it is a background thread nobody is looking at, and the tab
  stays alive enough to show what is happening and to stop it.

  Cancellation is cooperative and checked between entries, which is the finest granularity the
  decompressor offers. A cancel during one very large member waits for that member. That is
  worth knowing and not worth fixing: the alternative is terminating the worker, which the
  client does anyway when the wait is unreasonable.
*/

type ExpandRequest = { type: "expand"; id: number; bytes: ArrayBuffer };
type CancelRequest = { type: "cancel"; id: number };
export type ArchiveWorkerRequest = ExpandRequest | CancelRequest;

export type ArchiveWorkerResponse =
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "done"; id: number; entries: Array<{ path: string; bytes: ArrayBuffer }> }
  | { type: "error"; id: number; reason: string };

const cancelled = new Set<number>();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ArchiveWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled.add(message.id);
    return;
  }
  if (message.type !== "expand") return;

  const { id } = message;
  try {
    const entries = expandArchive(new Uint8Array(message.bytes), {
      onProgress: (done, total) => scope.postMessage({ type: "progress", id, done, total } satisfies ArchiveWorkerResponse),
      isCancelled: () => cancelled.has(id),
    });
    /*
      Transfer the buffers rather than copy them.

      A 200MB archive expanding to several hundred megabytes copied across the boundary would
      briefly hold both, which is the memory ceiling this whole change was meant to raise.
    */
    const payload = entries.map((entry) => ({ path: entry.path, bytes: toArrayBuffer(entry.bytes) }));
    scope.postMessage(
      { type: "done", id, entries: payload } satisfies ArchiveWorkerResponse,
      payload.map((entry) => entry.bytes),
    );
  } catch (error) {
    scope.postMessage({
      type: "error",
      id,
      reason: error instanceof Error ? error.message : "ARCHIVE_EXPANSION_FAILED",
    } satisfies ArchiveWorkerResponse);
  } finally {
    cancelled.delete(id);
  }
};

/** fflate hands back views into a shared buffer; a transfer needs a buffer of its own. */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
