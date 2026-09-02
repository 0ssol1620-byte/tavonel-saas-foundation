import { unzipSync } from "fflate";
import { qualifiedDocumentInputs } from "./qualified-input";

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 128;
const MAX_RATIO = 100;

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

function safeRelativePath(value: string) {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = path.split("/").filter(Boolean);
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || parts.some((part) => part === "." || part === "..")) {
    throw new Error("ARCHIVE_PATH_TRAVERSAL");
  }
  return parts.join("/");
}

function inferredMime(path: string) {
  const lower = path.toLowerCase();
  for (const [extension, mime] of mimeByExtension) if (lower.endsWith(extension)) return mime;
  return null;
}

function inspectCentralDirectory(bytes: Uint8Array) {
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

export async function prepareWorkspaceSelection(input: File[]): Promise<WorkspaceSelection> {
  const files: PreparedWorkspaceFile[] = [];
  const unsupported: string[] = [];
  const warnings: string[] = [];
  let archiveCount = 0;

  for (const source of input) {
    const relativePath = safeRelativePath((source as File & { webkitRelativePath?: string }).webkitRelativePath || source.name);
    if (/\.zip$/i.test(source.name)) {
      archiveCount += 1;
      if (source.size > MAX_ARCHIVE_BYTES) throw new Error("ARCHIVE_TOO_LARGE");
      const bytes = new Uint8Array(await source.arrayBuffer());
      inspectCentralDirectory(bytes);
      const entries = unzipSync(bytes);
      for (const [entryPath, entryBytes] of Object.entries(entries)) {
        const safePath = safeRelativePath(entryPath);
        const mime = inferredMime(safePath);
        if (!mime) { unsupported.push(safePath); continue; }
        const uploadName = safePath.replaceAll("/", "__");
        files.push({ file: uploadFile([entryBytes], uploadName, mime, safePath), relativePath: safePath });
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
