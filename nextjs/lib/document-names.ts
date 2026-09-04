/**
 * Human-facing names for immutable documents.
 *
 * Filenames are intentionally remembered only in the browser that uploaded them. When that
 * browser no longer knows a filename we still need a stable label, but an internal `doc-*`
 * identifier must never become the primary product copy. `shortHandle` therefore produces a
 * compact source label; the immutable id remains available to receipts and technical details.
 */

const KEY = "tavonel.document-names.v1";
const LIMIT = 500;
const MAX_NAME = 180;

export type DocumentNames = Record<string, string>;

/** Stable, human-facing fallback when the original filename is unavailable on this device. */
export function shortHandle(documentId: string): string {
  const head = documentId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 6).toUpperCase();
  return head.length > 0 ? `Source ${head}` : "Unnamed source";
}

/** Elide the middle of a long immutable key while preserving the useful prefix and artifact. */
export function elideKey(key: string, head = 16, tail = 26): string {
  if (key.length <= head + tail + 3) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

function read(): DocumentNames {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DocumentNames = {};
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name === "string" && name.length > 0) out[id] = name.slice(0, MAX_NAME);
    }
    return out;
  } catch {
    return {};
  }
}

export function recallDocumentNames(): DocumentNames {
  return read();
}

export function rememberDocumentName(documentId: string, filename: string): DocumentNames {
  const current = read();
  if (typeof window === "undefined" || !documentId || !filename) return current;
  const next: DocumentNames = { ...current, [documentId]: filename.slice(0, MAX_NAME) };
  const ids = Object.keys(next);
  const trimmed: DocumentNames = ids.length <= LIMIT
    ? next
    : Object.fromEntries(ids.slice(ids.length - LIMIT).map((id) => [id, next[id]]));
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // A full or disabled store costs the visitor a nicer label, never the underlying document.
  }
  return trimmed;
}

/** What to print for a document, in order of how much it tells the person reading it. */
export function displayName(documentId: string, names: DocumentNames, local?: string | null): string {
  return names[documentId] ?? local ?? shortHandle(documentId);
}
