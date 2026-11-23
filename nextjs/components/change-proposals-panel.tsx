"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicProposal, ProposalState } from "@/lib/change-proposals";
import styles from "./change-proposals-panel.module.css";

/*
  Proposals in Changes (WO-D30-3, WO-AN-6): requests for a change to the World, waiting for a confirmation.
  Creating a proposal changed nothing; the preview is the change it would make. Confirm and Reject
  exist only while a proposal is Proposed, Undo only once a label change is Done, Finish only on a row
  this person confirmed that never completed. Every control is chosen from the state the server last
  returned. A click never assumes its own outcome: the list is read again afterwards, and a lost
  response says it could not be confirmed instead of announcing success.
  The list is the workspace inbox, a page at a time; `?proposal=<id>` opens one row.
*/

type Props = { collectionId?: string | null };
type Load = { state: "loading" } | { state: "unavailable" } | { state: "ready"; proposals: PublicProposal[]; nextCursor: string | null };
export type Action = "confirm" | "reject" | "undo" | "finish";

const STATE_WORD: Record<ProposalState, string> = {
  proposed: "Proposed", confirmed: "Confirmed", executed: "Done", rejected: "Rejected",
  expired: "Expired", stale: "Out of date", failed: "Failed", undone: "Undone", withdrawn: "Withdrawn",
};
const REFUSED: Record<number, string> = {
  403: "You can not decide on this proposal.",
  409: "This proposal can no longer be changed. The list now shows the latest.",
};
const PREVIEW_CHANGED = "This suggestion changed since it was shown. Review it again.";
const NOT_AVAILABLE = "This suggestion is not available.";

export function decisionProblem(status: number, code?: string | null): string | null {
  if (status === 200) return null;
  if (status === 0 || status >= 500) return "The response could not be confirmed. The list below was read again and shows what was recorded.";
  if (status === 409 && code === "PROPOSAL_PREVIEW_CHANGED") return PREVIEW_CHANGED;
  return REFUSED[status] ?? "The decision was not saved. Try again.";
}

/** The request body of one action, or null when it must not be sent (a confirm of a preview that was not shown). */
export function actionBody(proposal: PublicProposal, action: Action): Record<string, unknown> | null {
  const base = { collectionId: proposal.collectionId };
  if (action === "undo") return base;
  if (action === "reject") return { ...base, decision: "reject" };
  if (action === "finish") return { ...base, decision: "confirm" };
  // A confirmation carries the digest of the preview this row rendered; the server refuses any other.
  return proposal.previewDigest === null ? null : { ...base, decision: "confirm", previewDigest: proposal.previewDigest };
}

/** The controls a row offers, chosen from its state alone. */
export function rowActions(proposal: PublicProposal): Action[] {
  if (proposal.state === "proposed") return actionBody(proposal, "confirm") ? ["confirm", "reject"] : ["reject"];
  if (proposal.state === "confirmed") return proposal.resumable ? ["finish"] : [];
  // Only a label change has an undo; the other types are not offered one the server would refuse.
  if (proposal.state === "executed") return proposal.actionType === "library_label" ? ["undo"] : [];
  return [];
}

/** Batch confirm is a loop of single confirms, offered for label rows only. */
export const batchEligible = (proposals: readonly PublicProposal[]) =>
  proposals.filter((p) => p.actionType === "library_label" && rowActions(p).includes("confirm"));

/** The badge in three parts, so the client-chosen name can sit in its own bidi isolate. */
export const agentBadgeParts = (proposer: PublicProposal["proposer"]) =>
  proposer.kind === "agent" ? { head: `Suggested by an agent connected by ${proposer.grantedBy} — client name “`, label: proposer.clientLabel, tail: "” (not verified)" } : null;

export const agentBadge = (proposer: PublicProposal["proposer"]): string | null => {
  const parts = agentBadgeParts(proposer);
  return parts ? parts.head + parts.label + parts.tail : null;
};

async function api(path: string, init: RequestInit = {}) {
  const client = getSupabaseBrowserClient();
  const token = client ? (await client.auth.getSession()).data.session?.access_token ?? null : null;
  return fetch(path, { ...init, cache: "no-store", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}) } });
}

const ACTION_TYPES: ReadonlySet<string> = new Set(["library_label", "compile_plan", "ontology_label_patch"]);

/** A page of rows: a row of an action type this build does not know is left out; any other malformed row refuses the page. */
export function listable(proposals: readonly PublicProposal[]): PublicProposal[] | null {
  const known = proposals.filter((p) => !p || ACTION_TYPES.has(p.actionType));
  return known.every(wellFormed) ? known : null;
}

/** A deep-linked row whose read by id answered 404 is gone: it is cleared, not shown stale. */
export const deepLinkGone = (one: { proposal: PublicProposal } | { status: number }) => "status" in one && one.status === 404;

const wellFormed = (p: PublicProposal) => Boolean(p) && p.state in STATE_WORD && typeof p.proposalId === "string" && Array.isArray(p.evidenceIds)
  && Boolean(p.proposer) && typeof p.createdAt === "string";

async function fetchPage(cursor: string | null): Promise<{ proposals: PublicProposal[]; nextCursor: string | null } | null> {
  try {
    const response = await api(cursor ? `/api/proposals?cursor=${encodeURIComponent(cursor)}` : "/api/proposals");
    const body = await response.json().catch(() => null) as { proposals?: PublicProposal[]; nextCursor?: string | null } | null;
    const rows = response.ok && body && Array.isArray(body.proposals) ? listable(body.proposals) : null;
    if (!body || !rows) return null;
    return { proposals: rows, nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null };
  } catch {
    return null;
  }
}

/** The first `pages` pages, so a re-read after a click keeps what "Show more" had loaded. */
async function fetchPages(pages: number): Promise<Load> {
  const all: PublicProposal[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    const read = await fetchPage(cursor);
    if (!read) return { state: "unavailable" };
    all.push(...read.proposals);
    cursor = read.nextCursor;
    if (!cursor) break;
  }
  return { state: "ready", proposals: all, nextCursor: cursor };
}

/** One proposal by id: the row, or the HTTP status that refused it. */
async function fetchOne(id: string): Promise<{ proposal: PublicProposal } | { status: number }> {
  try {
    const response = await api(`/api/proposals/${encodeURIComponent(id)}`);
    const body = await response.json().catch(() => null) as { proposal?: PublicProposal } | null;
    return response.ok && body?.proposal && ACTION_TYPES.has(body.proposal.actionType) && wellFormed(body.proposal) ? { proposal: body.proposal } : { status: response.ok ? 503 : response.status };
  } catch {
    return { status: 0 };
  }
}

const rowDomId = (proposalId: string) => `proposal-${proposalId}`;

function Preview({ proposal }: { proposal: PublicProposal }) {
  if (proposal.preview === null) return <p className={styles.note}>The change is not shown for this proposal.</p>;
  if (proposal.actionType === "library_label") {
    const preview = proposal.preview;
    return (
      <p className={styles.preview}>
        {preview.decision === "confirmed" ? "Confirm" : "Reject"} {preview.labelKind === "doc_type" ? "type" : "topic"}{" "}
        <strong><bdi>{preview.labelKind === "doc_type" ? preview.labelKey.replace(/_/g, " ") : preview.labelKey}</bdi></strong> on <span className={styles.id}>{preview.documentId}</span>
      </p>
    );
  }
  if (proposal.actionType === "compile_plan") {
    const { documentIds, documentsTotal, parts, quote } = proposal.preview;
    return (
      <div className={styles.detail}>
        <p className={styles.preview}>Compile {documentsTotal} {documentsTotal === 1 ? "document" : "documents"} in {parts} {parts === 1 ? "part" : "parts"}.</p>
        <div className={styles.ids} role="group" aria-label="Documents">
          {documentIds.map((id) => <span key={id} className={styles.id}>{id}</span>)}
        </div>
        <p className={styles.note}>
          {quote.rechargeCredits === 0 ? "Re-charges no credits."
            : `Re-charges up to ${quote.rechargeCredits} credits${quote.overageCredits > 0 ? `, of which up to ${quote.overageCredits} as overage` : ""}.`}
        </p>
        {proposal.notes.includes("approver_only")
          ? <p className={styles.note}>Only the person who approved these files at upload can start this compile.</p> : null}
      </div>
    );
  }
  const { kind, before, after, baseManifestDigest } = proposal.preview;
  return (
    <p className={styles.preview}>
      Correct {kind.toLowerCase()} label: <q><bdi>{before}</bdi></q> → <q><bdi>{after}</bdi></q>{" "}
      <span className={styles.id}>base {baseManifestDigest.replace(/^sha256:/, "").slice(0, 12)}</span>
    </p>
  );
}

/** One row. Presentational: what it offers comes from `rowActions`, what a click does from the parent. */
export function ProposalItem({ proposal, disabled, onAct }: { proposal: PublicProposal; disabled: boolean; onAct: (action: Action) => void }) {
  const badge = agentBadgeParts(proposal.proposer);
  const label: Record<Action, string> = { confirm: "Confirm", reject: "Reject", undo: "Undo", finish: "Finish" };
  return (
    <li id={rowDomId(proposal.proposalId)} tabIndex={-1} className={styles.row} data-state={proposal.state}>
      <span className={styles.state}>{STATE_WORD[proposal.state]}</span>
      {badge ? <p className={styles.note}>{badge.head}<bdi>{badge.label}</bdi>{badge.tail}</p> : null}
      <Preview proposal={proposal} />
      {proposal.evidenceIds.length > 0 ? <p className={styles.note}>Evidence: <span className={styles.id}>{proposal.evidenceIds.join(", ")}</span></p> : null}
      <div className={styles.actions}>
        {rowActions(proposal).map((action) => (
          <button key={action} type="button" className={styles.action} disabled={disabled} onClick={() => onAct(action)}>{label[action]}</button>
        ))}
      </div>
    </li>
  );
}

export default function ChangeProposalsPanel(_props: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [extra, setExtra] = useState<PublicProposal | null>(null);
  const tried = useRef<string | null>(null); // the deep-linked id already read by id
  const focusedId = useRef<string | null>(null);
  const extraId = useRef<string | null>(null);
  const pages = useRef(1);

  const refresh = useCallback(async () => {
    setLoad(await fetchPages(pages.current));
    // A deep-linked row that is not on a loaded page is read again by id, so it never shows a stale state.
    if (extraId.current) {
      const one = await fetchOne(extraId.current);
      if ("proposal" in one) setExtra(one.proposal);
      else if (deepLinkGone(one)) { extraId.current = null; setExtra(null); setProblem(NOT_AVAILABLE); }
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function post(proposal: PublicProposal, action: Action): Promise<{ status: number; code: string | null }> {
    const body = actionBody(proposal, action);
    if (!body) return { status: 400, code: null };
    try {
      const response = await api(`/api/proposals/${proposal.proposalId}/${action === "undo" ? "undo" : "decision"}`, { method: "POST", body: JSON.stringify(body) });
      const reply = await response.json().catch(() => null) as { code?: string } | null;
      return { status: response.ok ? 200 : response.status, code: typeof reply?.code === "string" ? reply.code : null };
    } catch {
      return { status: 0, code: null };
    }
  }

  async function act(proposal: PublicProposal, action: Action) {
    setBusy(proposal.proposalId);
    setProblem(null);
    try {
      const { status, code } = await post(proposal, action);
      setProblem(decisionProblem(status, code));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  // A loop of single confirms; it stops at the first one that did not go through.
  async function confirmAll(rows: PublicProposal[]) {
    setBusy("batch");
    setProblem(null);
    try {
      for (const row of rows) {
        const { status, code } = await post(row, "confirm");
        if (status !== 200) { setProblem(decisionProblem(status, code)); break; }
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function showMore() {
    if (load.state !== "ready" || !load.nextCursor) return;
    setBusy("more"); // Show more is disabled while this read is out: no second request, no duplicate page or key
    try {
      const read = await fetchPage(load.nextCursor);
      if (!read) { setProblem("More could not be read."); return; }
      pages.current += 1;
      setLoad({ state: "ready", proposals: [...load.proposals, ...read.proposals], nextCursor: read.nextCursor });
    } finally {
      setBusy(null);
    }
  }

  // Deep link: ?proposal=<id>. On a loaded page the row is focused; otherwise it is read by id.
  const ready = load.state === "ready";
  useEffect(() => {
    if (!ready) return;
    const id = new URLSearchParams(window.location.search).get("proposal");
    if (!id) return;
    const target = document.getElementById(rowDomId(id));
    if (target) {
      if (focusedId.current === id) return;
      focusedId.current = id;
      target.scrollIntoView({ block: "center" });
      target.focus();
      return;
    }
    if (tried.current === id) return;
    tried.current = id;
    void fetchOne(id).then((one) => {
      if ("proposal" in one) { extraId.current = id; setExtra(one.proposal); }
      else setProblem(deepLinkGone(one) ? NOT_AVAILABLE : "The suggestion could not be read.");
    });
  }, [ready, extra]);

  if (load.state === "loading") return <section className={styles.surface} aria-busy="true"><p className={styles.note}>Reading proposals…</p></section>;
  if (load.state === "unavailable") {
    return (
      <section className={styles.surface}>
        <h2>Proposals</h2>
        <p className={styles.note} role="status">Proposals could not be read. Nothing is shown rather than a partial list.</p>
        <button type="button" className={styles.action} onClick={() => { setLoad({ state: "loading" }); void refresh(); }}>Try again</button>
      </section>
    );
  }

  const listed = new Set(load.proposals.map((p) => p.proposalId));
  const rows = extra && !listed.has(extra.proposalId) ? [extra, ...load.proposals] : load.proposals;
  const batch = batchEligible(rows);
  const disabled = busy !== null;
  return (
    <section className={styles.surface} aria-labelledby="change-proposals-title">
      <div className={styles.intro}>
        <h2 id="change-proposals-title">Proposals</h2>
        <p>A proposal changes nothing until it is confirmed in a signed-in session. Confirm or reject each one; a confirmed label change can be undone.</p>
      </div>
      {problem ? <p className={styles.problem} role="status">{problem}</p> : null}
      {batch.length > 1 ? (
        <div className={styles.actions}>
          <button type="button" className={styles.action} disabled={disabled} onClick={() => void confirmAll(batch)}>Confirm all label suggestions ({batch.length})</button>
        </div>
      ) : null}
      {rows.length === 0 ? <p className={styles.empty}>No proposals.</p> : (
        <ul className={styles.list}>
          {rows.map((proposal) => (
            <ProposalItem key={proposal.proposalId} proposal={proposal} disabled={disabled} onAct={(action) => void act(proposal, action)} />
          ))}
        </ul>
      )}
      {load.nextCursor ? <div className={styles.actions}><button type="button" className={styles.action} disabled={disabled} onClick={() => void showMore()}>Show more</button></div> : null}
    </section>
  );
}
