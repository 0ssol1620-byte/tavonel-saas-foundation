/**
 * What to call a document when the server will not tell you its name.
 *
 * The workspace listed nineteen documents as `10fc3cfd-2cef-49f6-8ff5-7a2bb6ed360d` and
 * nothing else. A customer cannot tell which of their files that is, cannot tell two of them
 * apart at a glance, and cannot say it out loud to a colleague. The id is not the problem --
 * every receipt, every immutable key and every audit line refers to it, so it has to stay
 * reachable -- the problem is that it was the *only* thing on offer.
 *
 * The server does not return filenames, deliberately: a filename is customer content
 * ("Acme_acquisition_termsheet.pdf" says a great deal before anyone opens it), and the intake
 * boundary keeps what it stores to the minimum. That decision is not being reversed here. The
 * name is remembered in the browser that did the upload, in that browser only, and never sent
 * anywhere -- which is the one place it can live without the product knowing more than it needs
 * to.
 *
 * That leaves the case the storage cannot cover: a document uploaded on a different device, or
 * in a window whose storage has since been cleared. For those there is `shortHandle`, which is
 * not a name but is at least a thing a person can hold in their head and compare across two
 * panels. A 36-character UUID is neither.
 */

const KEY = "tavonel.document-names.v1";
/** Enough for any realistic pilot batch, small enough that the entry can never grow unbounded. */
const LIMIT = 500;
/** A filename is customer content; there is no reason to keep an unbounded one. */
const MAX_NAME = 180;

export type DocumentNames = Record<string, string>;

/**
 * A short, stable, sayable handle for a document that has no remembered name.
 *
 * The first block of a UUID is 32 bits. Across a pilot batch of a few dozen documents a
 * collision is not a practical concern, and the whole id is still on screen underneath -- this
 * is a label for recognising a row again, not an identifier anything is keyed on.
 *
 * Deliberately not a generated nickname. A colour-and-animal handle would read better and would
 * be a second name for a thing that already has one; a reader who saw "amber-harbour" here and
 * `10fc3cfd-…` in a receipt would have no way to connect them. This is the id, shortened.
 */
export function shortHandle(documentId: string): string {
  const head = documentId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8);
  return head.length > 0 ? `doc-${head}` : "doc";
}

/**
 * The middle of a long immutable key, removed.
 *
 * These keys are receipts and the whole point of them is that they can be checked, so the value
 * is never altered and never truncated in the DOM -- only what is drawn is shortened. The head
 * says which bucket and tenant, the tail says which artifact, and the hash in between is the
 * part no one reads on screen and everyone copies whole.
 *
 * The default head is exactly the bucket-and-tenant prefix and the tail is long enough to keep
 * the artifact name -- `sanitized.pdf`, `cdr-receipt.json` -- which is the only part of the
 * string a person is scanning for. Short enough to survive the narrowest column the card has.
 */
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
    // Storage being unavailable or holding something else must never break the workspace.
    return {};
  }
}

/** Everything this browser remembers. Safe to call during an effect; returns {} on the server. */
export function recallDocumentNames(): DocumentNames {
  return read();
}

/**
 * Remember what the visitor called this file.
 *
 * Returns the updated map so a caller can put it straight into state rather than reading back
 * from storage, which would fail silently in a browser that refused the write.
 */
export function rememberDocumentName(documentId: string, filename: string): DocumentNames {
  const current = read();
  if (typeof window === "undefined" || !documentId || !filename) return current;
  const next: DocumentNames = { ...current, [documentId]: filename.slice(0, MAX_NAME) };
  const ids = Object.keys(next);
  // Oldest-first eviction: JSON preserves insertion order, and a spread of an existing key keeps
  // its original position, so the entries at the front are the ones written longest ago.
  const trimmed: DocumentNames = ids.length <= LIMIT
    ? next
    : Object.fromEntries(ids.slice(ids.length - LIMIT).map((id) => [id, next[id]]));
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // A full or disabled store costs the visitor a nicer label, nothing more.
  }
  return trimmed;
}

/** What to print for a document, in order of how much it tells the person reading it. */
export function displayName(documentId: string, names: DocumentNames, local?: string | null): string {
  return names[documentId] ?? local ?? shortHandle(documentId);
}
