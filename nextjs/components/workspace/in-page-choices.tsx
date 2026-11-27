"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useDialogFocus } from "@/components/world-visual/use-dialog-focus";
import { formatTimestamp } from "@/lib/format";
import { shortReference } from "@/lib/plain-language";
import { failureSentence } from "@/lib/workspace-failure-copy";
import type { ActiveWorldSummary } from "@/lib/world-store";

/*
  Two decisions the workspace page used to leave to the browser (WO-WS-1, 2026-11-23).

  1. Which World does Ask read when the URL names none? The page asks the server for the
     workspace's active Worlds (GET /api/v1/collections, the read the API and MCP already use) and
     acts on exactly four outcomes. One World is loaded. Several are listed for the person to
     choose from -- none is loaded silently. None keeps the "No active World yet" sentence. A
     failed or malformed listing is "could not check", never "none": that sentence is a statement
     of fact about the workspace and a failed read does not establish it.
  2. Consequential confirmations (cost approval, activation, rollback) were `window.confirm`,
     which blocks the page for assistive and automated clients and cannot be focused or tested.
     They are an in-page native `<dialog>` now: focus moves to it, Escape and Cancel settle false.
*/

const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const MANIFEST = /^sha256:[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PAGE_LIMIT = 50;
// ponytail: 20 pages x 50 = 1,000 active Worlds; past that the panel says it could not check all of them.
const MAX_PAGES = 20;

export type ActiveWorldDiscovery =
  | { kind: "none" }
  | { kind: "one"; world: ActiveWorldSummary }
  | { kind: "several"; worlds: ActiveWorldSummary[] }
  /* `status` is the HTTP status of a refused or failed answer; null when no answer came back, or when
     an OK answer was malformed (the server did not do what it said -- not a refusal). */
  | { kind: "failed"; code: string | null; status: number | null };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function parseWorld(value: unknown): ActiveWorldSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const { collectionId, manifestDigest, revision, updatedAt } = row;
  if (typeof collectionId !== "string" || !COLLECTION_ID.test(collectionId)) return null;
  if (typeof manifestDigest !== "string" || !MANIFEST.test(manifestDigest)) return null;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (typeof updatedAt !== "string" || updatedAt.length > 64 || !Number.isFinite(Date.parse(updatedAt))) return null;
  return { collectionId, manifestDigest, revision, updatedAt };
}

/**
 * The workspace's active Worlds, every page, most recently activated first. Any row that does not
 * parse, a cursor that does not, a repeated collection, a non-OK answer or a thrown fetch is
 * `failed`: a partial list would let the page load "the only one" when it is not.
 */
export async function discoverActiveWorlds(token: string, fetchImpl: FetchLike = fetch): Promise<ActiveWorldDiscovery> {
  const worlds: ActiveWorldSummary[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);
      const response = await fetchImpl(`/api/v1/collections?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { authorization: `Bearer ${token}` },
        // A listing that never answers is "could not check", not a panel stuck on "Checking…".
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !body || body.code !== "COLLECTIONS_LISTED" || !Array.isArray(body.collections)) {
        const code = typeof body?.code === "string" && CODE.test(body.code) ? body.code : null;
        return { kind: "failed", code, status: response.ok ? null : response.status };
      }
      for (const item of body.collections) {
        const world = parseWorld(item);
        if (!world || seen.has(world.collectionId)) return { kind: "failed", code: "ACTIVE_WORLD_BINDING_INVALID", status: null };
        seen.add(world.collectionId);
        worlds.push(world);
      }
      const next = (body.page as Record<string, unknown> | undefined)?.nextCursor;
      if (next === null) {
        worlds.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.collectionId.localeCompare(b.collectionId));
        if (worlds.length === 0) return { kind: "none" };
        if (worlds.length === 1) return { kind: "one", world: worlds[0] };
        return { kind: "several", worlds };
      }
      if (typeof next !== "string" || !COLLECTION_ID.test(next)) return { kind: "failed", code: "WORLD_PAGE_CURSOR_INVALID", status: null };
      cursor = next;
    }
    return { kind: "failed", code: "ACTIVE_WORLD_LIST_TOO_LONG", status: null };
  } catch {
    return { kind: "failed", code: null, status: null };
  }
}

/*
  What a failed listing says. A 401/402/403 is the server refusing this session the listing -- a
  refusal, worded as one -- not an outage. With no HTTP answer (a thrown or timed-out fetch, or an OK
  answer that was malformed) the server did not complete the read, which is the 5xx sentence.
*/
export function discoveryFailureCopy(failed: { code: string | null; status: number | null }) {
  const refused = failed.status === 401 || failed.status === 402 || failed.status === 403;
  return {
    title: refused ? "This session may not list the workspace's active Worlds." : "Active Worlds could not be checked.",
    sentence: failureSentence(failed.code, failed.status ?? 503),
  };
}

/*
  What the page does with a listing. It opens the only active World on its own only when the page
  holds no collection; with one already selected (a candidate just compiled, a revision from the
  URL) even a single World is offered for a choice, so the selection is never replaced silently.
*/
export function discoveryOutcome(found: ActiveWorldDiscovery, selected: boolean):
  | { open: ActiveWorldSummary }
  | { show: Exclude<AskWorldState, "idle" | "checking" | "opening" | { kind: "open-failed" }> } {
  if (found.kind !== "one") return { show: found };
  return selected ? { show: { kind: "several", worlds: [found.world] } } : { open: found.world };
}

/*
  What Ask's panel shows while the page has no active World. "one" is never a resting state: the
  page opens that World at once and records what the open observed, so "could not be opened" is
  said only after an open that did not load an active World -- never inferred later from
  `activeWorld` being empty (a new compile clears it, and nothing failed to open).
*/
export type AskWorldState =
  | "idle"
  | "checking"
  | "opening"
  | Exclude<ActiveWorldDiscovery, { kind: "one" }>
  | { kind: "open-failed" };

/** The state after opening a discovered World, from the active World the load returned. */
export function activeWorldOpenOutcome(loaded: { manifestDigest: string } | null | undefined): "idle" | { kind: "open-failed" } {
  return loaded ? "idle" : { kind: "open-failed" };
}

/*
  The panel Ask renders: nothing once a World is loaded. "idle" is a listing that has not run yet --
  the page is still starting, or the World state was just cleared and the listing runs again -- so it
  reads "checking". "No active World yet" is said only after a listing answered "none".
*/
export function askWorldPanel(activeWorld: unknown, state: AskWorldState) {
  if (activeWorld) return null;
  if (state === "idle") return "checking";
  if (typeof state === "object" && state.kind === "none") return "none";
  return state;
}

export function activeWorldOptionLabel(world: ActiveWorldSummary) {
  const activated = formatTimestamp(world.updatedAt);
  /* D-03: the collection id is a reference, not a name; its short tail tells two Worlds apart. */
  return `Revision ${world.revision}${activated ? ` · activated ${activated}` : ""} · ref ${shortReference(world.collectionId)}`;
}

/** Several active Worlds: the person picks one. Nothing is preselected into Ask. */
export function ActiveWorldPicker({
  worlds,
  disabled,
  onChoose,
}: {
  worlds: ActiveWorldSummary[];
  disabled?: boolean;
  onChoose: (world: ActiveWorldSummary) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState("");
  const world = worlds.find((item) => item.collectionId === chosen);
  return (
    <form
      className="notice static"
      onSubmit={(event) => { event.preventDefault(); if (world) onChoose(world); }}
    >
      <strong>{worlds.length === 1 ? "This workspace has 1 active World." : `This workspace has ${worlds.length} active Worlds.`}</strong> Choose the one Ask should read.
      <label htmlFor={id}>Active World</label>
      <select id={id} value={chosen} disabled={disabled} onChange={(event) => setChosen(event.target.value)}>
        <option value="">Choose an active World…</option>
        {worlds.map((item) => (
          <option key={item.collectionId} value={item.collectionId}>{activeWorldOptionLabel(item)}</option>
        ))}
      </select>
      <button type="submit" disabled={disabled || !world}>Ask this World</button>
    </form>
  );
}

export type ConfirmRequest = { id: number; message: string; confirmLabel: string; settle: (confirmed: boolean) => void };

let confirmSequence = 0;

/**
 * Opens one in-page confirmation and resolves with the person's answer. `settle` clears the
 * request before resolving, and only the first settle counts, so a double click cannot act twice.
 * A confirmation opened while another is pending supersedes it: the earlier one settles false (it
 * was never answered yes), and the dialog is keyed by `id`, so the new one opens as its own dialog.
 * `pending` is the page's ref to the open request; the state setter alone cannot see it.
 */
export function requestConfirm(
  pending: { current: ConfirmRequest | null },
  setRequest: (request: ConfirmRequest | null) => void,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  pending.current?.settle(false);
  return new Promise((resolve) => {
    let settled = false;
    const request: ConfirmRequest = {
      id: ++confirmSequence,
      message,
      confirmLabel,
      settle: (confirmed) => {
        if (settled) return;
        settled = true;
        if (pending.current === request) {
          pending.current = null;
          setRequest(null);
        }
        resolve(confirmed === true);
      },
    };
    pending.current = request;
    setRequest(request);
  });
}

/** The dialog's markup and handlers, without hooks, so the real handlers can be exercised directly. */
export function ConfirmDialogBody({
  request,
  titleId,
  dialogRef,
  cancelRef,
}: {
  request: ConfirmRequest;
  titleId: string;
  dialogRef?: RefObject<HTMLDialogElement | null>;
  cancelRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); request.settle(false); }}
      style={{ width: "min(520px, calc(100vw - 32px))", padding: 24, border: "1px solid var(--hairline-hi)", borderRadius: 12, background: "var(--g1)", color: "var(--text-mid)" }}
    >
      <p id={titleId} style={{ margin: "0 0 16px", color: "var(--text-hi)", fontSize: 16, lineHeight: 1.5, overflowWrap: "anywhere" }}>{request.message}</p>
      <div className="billing-actions">
        <button type="button" ref={cancelRef} onClick={() => request.settle(false)}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => request.settle(true)}>{request.confirmLabel}</button>
      </div>
    </dialog>
  );
}

/** A modal native `<dialog>`: the page behind is inert, focus starts on Cancel and returns on close. */
export function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  // Declared before the effect that opens the dialog, so it records the opener for focus return.
  useDialogFocus(dialogRef);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
  }, []);
  return <ConfirmDialogBody request={request} titleId={titleId} dialogRef={dialogRef} cancelRef={cancelRef} />;
}
