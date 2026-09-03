import { unzipSync } from "fflate";

/*
  Archive expansion, and every guard that has to run before a byte is expanded.

  This was inside `workspace-intake.ts` and ran on the main thread: `arrayBuffer()`
  materialised the whole archive and `unzipSync` expanded it synchronously in the same task as
  the UI. At any interesting size that is not slow, it is a frozen tab -- no repaint, no
  cancel, and on a low-memory device a crashed renderer that loses the selection.

  It lives here so the worker and the main thread run the same code. That is the point of the
  move: a security check that exists in two copies is a security check that will eventually
  exist in one.
*/

/**
 * What the main thread can expand without stalling perceptibly.
 *
 * Kept as the ceiling for the fallback path -- an old browser, a blocked worker, a hostile
 * CSP -- because the number was chosen to describe a synchronous expansion and it still does.
 */
export const MAX_SYNC_ARCHIVE_BYTES = 25 * 1024 * 1024;

/**
 * What a worker can expand, where the cost is a busy background thread rather than a dead UI.
 *
 * Still bounded, and bounded by memory rather than by patience: the worker holds the archive
 * and its expansion at once, and a tab that runs out of memory dies whichever thread asked.
 */
export const MAX_WORKER_ARCHIVE_BYTES = 200 * 1024 * 1024;

export const MAX_EXPANDED_BYTES = 500 * 1024 * 1024;
export const MAX_FILES = 128;
const MAX_RATIO = 100;

export const ARCHIVE_LIMITS = {
  maxArchiveMb: MAX_WORKER_ARCHIVE_BYTES / (1024 * 1024),
  maxSyncArchiveMb: MAX_SYNC_ARCHIVE_BYTES / (1024 * 1024),
  maxExpandedMb: MAX_EXPANDED_BYTES / (1024 * 1024),
  maxFiles: MAX_FILES,
} as const;

export function safeRelativePath(value: string) {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = path.split("/").filter(Boolean);
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || parts.some((part) => part === "." || part === "..")) {
    throw new Error("ARCHIVE_PATH_TRAVERSAL");
  }
  return parts.join("/");
}

/**
 * Read the central directory and refuse the archive on its own declared numbers.
 *
 * Everything here happens before expansion, which is the entire value: traversal, absolute
 * paths, encryption, nested archives, the file count and the decompression ratio are all
 * decided from the directory, so a bomb is refused rather than survived.
 */
export function inspectCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (view.getUint32(offset, true) === 0x06054b50) end = offset;
  }
  if (end < 0) throw new Error("ARCHIVE_DIRECTORY_MISSING");
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (entries > MAX_FILES || cursor + directorySize > bytes.length) throw new Error("ARCHIVE_LIMIT_EXCEEDED");

  const decoder = new TextDecoder();
  let expandedBytes = 0;
  const paths: string[] = [];
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ARCHIVE_DIRECTORY_INVALID");
    const flags = view.getUint16(cursor + 8, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if ((flags & 1) !== 0) throw new Error("ARCHIVE_ENCRYPTED");
    const path = safeRelativePath(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
    if (/\.(zip|7z|rar|tar|gz)$/i.test(path)) throw new Error("NESTED_ARCHIVE_NOT_ALLOWED");
    expandedBytes += expanded;
    if (expandedBytes > MAX_EXPANDED_BYTES || (expanded > 10 * 1024 * 1024 && expanded / Math.max(1, compressed) > MAX_RATIO)) {
      throw new Error("DECOMPRESSION_BOMB_BLOCKED");
    }
    paths.push(path);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return paths;
}

/*
  `Uint8Array<ArrayBuffer>` rather than the default, which admits a SharedArrayBuffer.

  fflate never produces one, but the wider type makes these bytes unusable as a `BlobPart`,
  and the File constructor is where every one of them is going.
*/
export type ArchiveEntry = { path: string; bytes: Uint8Array<ArrayBuffer> };

export type ExpandOptions = {
  onProgress?: (done: number, total: number) => void;
  /** Checked between entries. Returns true to stop expanding. */
  isCancelled?: () => boolean;
};

/**
 * Expand an inspected archive, one entry at a time.
 *
 * The per-entry step is what makes progress and cancellation possible at all: `unzipSync`
 * with a filter calls back before each file, which is the only place either can be observed
 * without rewriting the decompressor.
 */
export function expandArchive(bytes: Uint8Array, options: ExpandOptions = {}): ArchiveEntry[] {
  const paths = inspectCentralDirectory(bytes);
  const total = paths.length;
  let done = 0;
  let cancelled = false;

  const entries = unzipSync(bytes, {
    filter: () => {
      if (cancelled || options.isCancelled?.()) {
        cancelled = true;
        return false;
      }
      done += 1;
      options.onProgress?.(done, total);
      return true;
    },
  });
  if (cancelled) throw new Error("ARCHIVE_CANCELLED");
  return Object.entries(entries).map(([path, data]) => ({
    path: safeRelativePath(path),
    bytes: data as Uint8Array<ArrayBuffer>,
  }));
}
