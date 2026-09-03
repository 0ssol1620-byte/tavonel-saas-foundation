import {
  ARCHIVE_LIMITS,
  expandArchive,
  MAX_FILES,
  MAX_SYNC_ARCHIVE_BYTES,
  safeRelativePath,
} from "./archive-expand";
import type { ArchiveExpander } from "./archive-client";
import { qualifiedDocumentInputs } from "./qualified-input";

/*
  Staging a selection: what the customer chose, expanded and checked, before anything moves.

  Archive expansion and every guard around it now live in `archive-expand.ts`, shared with the
  worker that runs them off the main thread. Nothing about the guards changed in that move --
  traversal, absolute paths, encryption, nested archives, the decompression-ratio bomb check
  and the file count all still run against the central directory before a byte is expanded --
  and keeping one copy is the point: a security check maintained in two places is a security
  check that will eventually exist in one.
*/

export { ARCHIVE_LIMITS };

const mimeByExtension = new Map(
  Object.entries(qualifiedDocumentInputs).flatMap(([mime, extensions]) =>
    extensions.map((extension) => [extension, mime] as const),
  ),
);

export type PreparedWorkspaceFile = { file: File; relativePath: string };
export type WorkspaceUploadFile = File & { tavonelRelativePath?: string };
export type WorkspaceSelection = {
  files: PreparedWorkspaceFile[];
  archiveCount: number;
  unsupported: string[];
  warnings: string[];
};

type DropFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath: string;
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
};

type DropDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath: string;
  createReader: () => { readEntries: (success: (entries: DropEntry[]) => void, failure?: (error: DOMException) => void) => void };
};

type DropEntry = DropFileEntry | DropDirectoryEntry;
type DropItem = { getAsFile: () => File | null; webkitGetAsEntry?: () => unknown };

function isDropEntry(value: unknown): value is DropEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== "string" || typeof entry.fullPath !== "string") return false;
  return (entry.isFile === true && entry.isDirectory === false && typeof entry.file === "function")
    || (entry.isFile === false && entry.isDirectory === true && typeof entry.createReader === "function");
}

function fileFromEntry(entry: DropFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

async function directoryEntries(entry: DropDirectoryEntry) {
  const reader = entry.createReader();
  const result: DropEntry[] = [];
  while (true) {
    const batch = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return result;
    result.push(...batch);
    if (result.length > MAX_FILES) throw new Error("FILE_COUNT_LIMIT_EXCEEDED");
  }
}

function withRelativePath(file: File, relativePath: string) {
  const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(copy, "webkitRelativePath", { configurable: false, enumerable: true, value: safeRelativePath(relativePath.replace(/^\/+/, "")) });
  return copy;
}

function uploadFile(parts: BlobPart[], uploadName: string, mime: string, relativePath: string): WorkspaceUploadFile {
  const file = new File(parts, uploadName, { type: mime }) as WorkspaceUploadFile;
  Object.defineProperty(file, "tavonelRelativePath", {
    configurable: false,
    enumerable: false,
    value: safeRelativePath(relativePath),
  });
  return file;
}

async function collectEntry(entry: DropEntry, output: File[]) {
  if (entry.isFile) {
    output.push(withRelativePath(await fileFromEntry(entry), entry.fullPath));
  } else {
    for (const child of await directoryEntries(entry)) await collectEntry(child, output);
  }
  if (output.length > MAX_FILES) throw new Error("FILE_COUNT_LIMIT_EXCEEDED");
}

export async function collectDroppedWorkspaceFiles(items: ArrayLike<DropItem>) {
  const output: File[] = [];
  for (const item of Array.from(items)) {
    const candidate = item.webkitGetAsEntry?.() ?? null;
    if (isDropEntry(candidate)) await collectEntry(candidate, output);
    else {
      const file = item.getAsFile();
      if (file) output.push(file);
    }
  }
  if (output.length > MAX_FILES) throw new Error("FILE_COUNT_LIMIT_EXCEEDED");
  return output;
}

function inferredMime(path: string) {
  const lower = path.toLowerCase();
  for (const [extension, mime] of mimeByExtension) if (lower.endsWith(extension)) return mime;
  return null;
}

export type PrepareOptions = {
  /**
   * Where archives are expanded. Omitted, everything runs on this thread with the smaller
   * ceiling -- the behaviour before the worker existed, kept as the honest fallback.
   */
  expander?: ArchiveExpander;
  onArchiveProgress?: (archive: string, done: number, total: number) => void;
  signal?: AbortSignal;
};

export async function prepareWorkspaceSelection(
  input: File[],
  options: PrepareOptions = {},
): Promise<WorkspaceSelection> {
  const files: PreparedWorkspaceFile[] = [];
  const unsupported: string[] = [];
  const warnings: string[] = [];
  let archiveCount = 0;

  const ceiling = options.expander?.ceilingBytes ?? MAX_SYNC_ARCHIVE_BYTES;

  for (const source of input) {
    if (options.signal?.aborted) throw new Error("SELECTION_CANCELLED");
    const relativePath = safeRelativePath((source as File & { webkitRelativePath?: string }).webkitRelativePath || source.name);
    if (/\.zip$/i.test(source.name)) {
      archiveCount += 1;
      // Checked against `source.size` before any read, so an oversized archive is refused
      // without ever being pulled into memory. The ceiling depends on where the expansion
      // will actually run: the larger one is only offered when a worker exists to absorb it.
      if (source.size > ceiling) throw new Error("ARCHIVE_TOO_LARGE");
      const entries = options.expander
        ? (await options.expander.expand(source, {
            signal: options.signal,
            onProgress: (done, total) => options.onArchiveProgress?.(relativePath, done, total),
          })).entries
        : expandArchive(new Uint8Array(await source.arrayBuffer()), {
            onProgress: (done, total) => options.onArchiveProgress?.(relativePath, done, total),
            isCancelled: () => options.signal?.aborted === true,
          });
      for (const entry of entries) {
        const mime = inferredMime(entry.path);
        if (!mime) { unsupported.push(entry.path); continue; }
        const uploadName = entry.path.replaceAll("/", "__");
        files.push({ file: uploadFile([entry.bytes], uploadName, mime, entry.path), relativePath: entry.path });
      }
      continue;
    }
    const mime = inferredMime(relativePath);
    if (!mime) { unsupported.push(relativePath); continue; }
    const uploadName = relativePath.replaceAll("/", "__");
    files.push({ file: uploadFile([source], uploadName, mime, relativePath), relativePath });
  }

  if (files.length > MAX_FILES) throw new Error("FILE_COUNT_LIMIT_EXCEEDED");
  if (unsupported.length > 0) warnings.push(`${unsupported.length} unsupported file${unsupported.length === 1 ? "" : "s"} will be skipped.`);
  if (archiveCount > 0) warnings.push("Archive paths were checked and the original hierarchy will be retained in source labels.");
  return { files, archiveCount, unsupported, warnings };
}
