"use client";

import { useCallback, useEffect, useState } from "react";
import { displayName, type DocumentNames } from "@/lib/document-names";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { LibraryDecision, LibraryDocument } from "@/lib/library-shadow";
import styles from "./library-panel.module.css";

/*
  The Library (WO-D23-4): what the compiler proposed for each source, with Unknown kept visible.

  Three groups by what a person can rely on: Confirmed (a person said so), Proposed (the compiler
  said so), Unknown (it declined to propose, or has not looked). A person confirms or rejects a
  label, and Undo withdraws the decision that stands on it. Nothing is deleted and no source is
  touched: a decision, and an Undo, is one appended row.

  What a click means is decided once, by the store: the newest decision standing on a label wins, so
  one Reject leaves the label rejected by a person whatever stood before it, and an Undo withdraws
  exactly the decision it names (or is refused as stale when someone decided since). Every control
  here is chosen from the Library's answer alone, so a reload shows the same controls, Undo included.

  When the Library is not enabled for this workspace the route answers 404 and this renders nothing.
  When it cannot be read it says so and shows no documents -- never a partial list.
*/

type Props = {
  documentIds: readonly string[];
  names: DocumentNames;
  /** Tells the page whether the Library exists for this workspace, so it can show or hide its entry. */
  onAvailability?: (available: boolean) => void;
};
export type Target = { documentId: string; labelKind: "doc_type" | "topic"; labelKey: string };
type Loaded = { documents: LibraryDocument[]; sourceVersions: Record<string, string> };
type Fetched = { state: "hidden" } | { state: "unavailable" } | ({ state: "ready" } & Loaded);
type Load = { state: "loading" } | Fetched;

const BADGE: Record<LibraryDocument["duplicates"][number]["badge"], string> = { exact: "Exact copy", near: "Near copy", revision: "Possible revision" };
const typeName = (label: string) => label.replace(/_/g, " ");
export const targetKey = (target: Target) => `${target.documentId}:${target.labelKind}:${target.labelKey}`;

export type LabelState = "proposed" | "confirmed" | "rejected";
/** What the Library says about one label of one document now; null when it says nothing about it. */
export function labelState(document: LibraryDocument, target: Target): LabelState | null {
  if (document.rejected.some((label) => label.kind === target.labelKind && label.label === target.labelKey)) return "rejected";
  if (target.labelKind === "doc_type") return document.documentType?.label === target.labelKey ? document.documentType.state : null;
  return document.topics.find((topic) => topic.label === target.labelKey)?.state ?? null;
}

export type LabelControl = "confirm" | "reject" | "undo";
/** A proposal can be confirmed or rejected; a person's standing decision can be reversed or undone. */
export function labelControls(state: LabelState | null): LabelControl[] {
  return state === "proposed" ? ["confirm", "reject"] : state === "confirmed" ? ["reject", "undo"] : state === "rejected" ? ["confirm", "undo"] : [];
}
/** The row a control writes. An Undo names the decision it withdraws, so the store can refuse it when that no longer stands. */
export function decisionFor(state: LabelState, control: LabelControl): LibraryDecision {
  if (control === "confirm") return "confirmed";
  if (control === "reject") return "rejected";
  return state === "rejected" ? "undo_rejected" : "undo_confirmed";
}

async function authToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

async function api(path: string, init: RequestInit = {}) {
  const token = await authToken();
  return fetch(path, { ...init, cache: "no-store", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}) } });
}

async function fetchLibrary(idsKey: string): Promise<Fetched> {
  if (idsKey === "") return { state: "ready", documents: [], sourceVersions: {} };
  try {
    const response = await api(`/api/library?documents=${encodeURIComponent(idsKey)}`);
    if (response.status === 404) return { state: "hidden" };
    const body = await response.json().catch(() => null) as ({ documents?: LibraryDocument[]; sourceVersions?: Record<string, string> }) | null;
    if (!response.ok || !body || !Array.isArray(body.documents) || !body.sourceVersions
      || !body.documents.every((document) => Array.isArray(document?.rejected) && Array.isArray(document?.topics))) return { state: "unavailable" };
    return { state: "ready", documents: body.documents, sourceVersions: body.sourceVersions };
  } catch {
    return { state: "unavailable" };
  }
}

function groupOf(document: LibraryDocument): "confirmed" | "proposed" | "unknown" {
  const type = document.documentType;
  return type?.state === "confirmed" ? "confirmed" : type?.state === "proposed" ? "proposed" : "unknown";
}

const REFUSED: Record<number, string> = {
  403: "You can not decide on this source.",
  409: "Someone changed this label meanwhile, so nothing was saved. The Library now shows the latest.",
};

export default function LibraryPanel({ documentIds, names, onAvailability }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const idsKey = documentIds.join(",");

  const refresh = useCallback(async () => setLoad(await fetchLibrary(idsKey)), [idsKey]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (load.state === "hidden") onAvailability?.(false);
    else if (load.state === "ready") onAvailability?.(true);
  }, [load.state, onAvailability]);

  /** One row, then the Library as the store now folds it: the panel shows only what the store says. */
  async function decide(target: Target, decision: LibraryDecision, sourceVersionId: string | undefined) {
    if (!sourceVersionId) return setProblem("This source has no recorded version to decide on yet.");
    setBusy(targetKey(target));
    setProblem(null);
    try {
      let status: number;
      try {
        const response = await api("/api/library/decisions", { method: "POST",
          body: JSON.stringify({ ...target, sourceVersionId, decision, idempotencyKey: crypto.randomUUID() }) });
        status = response.ok ? 200 : response.status;
      } catch {
        status = 0;
      }
      if (status !== 200) setProblem(REFUSED[status] ?? "The decision was not saved. Nothing changed. Try again.");
      // A refused or failed write changed nothing, but a stale Undo means the Library moved: read it either way.
      if (status === 200 || status === 409) await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (load.state === "hidden") return null;
  if (load.state === "loading") return <section className={styles.surface} aria-busy="true"><p className={styles.note}>Reading the Library…</p></section>;
  if (load.state === "unavailable") {
    return (
      <section className={styles.surface}>
        <h2>Library</h2>
        <p className={styles.note} role="status">The Library could not be read. Nothing is shown rather than a partial list.</p>
        <button type="button" className={styles.action} onClick={() => { setLoad({ state: "loading" }); void refresh(); }}>Try again</button>
      </section>
    );
  }

  const nameOf = (id: string) => displayName(id, names);
  const groups = [
    { id: "confirmed" as const, title: "Confirmed", note: "A person confirmed these labels." },
    { id: "proposed" as const, title: "Proposed", note: "The compiler proposed these. Confirm or reject each one." },
    { id: "unknown" as const, title: "Unknown", note: "No label is confirmed or proposed for these sources. They are listed, not hidden." },
  ].map((group) => ({ ...group, documents: load.documents.filter((document) => groupOf(document) === group.id) }));

  function controls(document: LibraryDocument, target: Target, sourceVersionId: string | undefined, label: string) {
    const state = labelState(document, target);
    const disabled = busy !== null;
    if (!state) return null;
    return labelControls(state).map((control) => (
      <button key={control} type="button" className={styles.action} disabled={disabled}
        onClick={() => void decide(target, decisionFor(state, control), sourceVersionId)}
        aria-label={control === "undo" ? `Undo ${state === "confirmed" ? "confirming" : "rejecting"} ${label}` : `${control === "confirm" ? "Confirm" : "Reject"} ${label}`}>
        {control === "undo" ? "Undo" : control === "confirm" ? "Confirm" : "Reject"}
      </button>
    ));
  }

  return (
    <section className={styles.surface} aria-label="Library">
      <header className={styles.intro}>
        <h2>Library</h2>
        <p>How your sources are organised. Nothing is deleted, and both sources stay when two look alike.</p>
      </header>
      {problem ? <p className={styles.problem} role="alert">{problem}</p> : null}
      {load.documents.length === 0 ? <p className={styles.note}>No sources to organise yet.</p> : null}
      {groups.map((group) => (
        <section key={group.id} className={styles.group} data-group={group.id} aria-labelledby={`library-${group.id}`}>
          <h3 id={`library-${group.id}`}>{group.title} <span className={styles.count}>{group.documents.length}</span></h3>
          <p className={styles.note}>{group.note}</p>
          {group.documents.length === 0 ? <p className={styles.empty}>None.</p> : (
            <ul className={styles.list}>
              {group.documents.map((document) => {
                const version = load.sourceVersions[document.documentId];
                const type = document.documentType;
                const typeTarget: Target | null = type?.label ? { documentId: document.documentId, labelKind: "doc_type", labelKey: type.label } : null;
                return (
                  <li key={document.documentId} className={styles.row}>
                    <strong className={styles.name}>{nameOf(document.documentId)}</strong>
                    <div className={styles.labels}>
                      {type?.label && typeTarget ? (
                        <span className={styles.label}>
                          <span className={styles.kind}>Type</span> {typeName(type.label)}
                          {controls(document, typeTarget, version, `type ${typeName(type.label)}`)}
                        </span>
                      ) : <span className={styles.label}><span className={styles.kind}>Type</span> Unknown</span>}
                      {document.topics.map((topic) => (
                        <span key={topic.label} className={styles.label}>
                          <span className={styles.kind}>Topic</span> {topic.label}
                          {controls(document, { documentId: document.documentId, labelKind: "topic", labelKey: topic.label }, version, `topic ${topic.label}`)}
                        </span>
                      ))}
                      {/* Labels a person rejected: the Library names them, so their Undo survives a reload. */}
                      {document.rejected.map((rejected) => {
                        const target: Target = { documentId: document.documentId, labelKind: rejected.kind, labelKey: rejected.label };
                        const kind = rejected.kind === "doc_type" ? "type" : "topic";
                        return (
                          <span key={targetKey(target)} className={styles.label}>
                            <span className={styles.kind}>{rejected.kind === "doc_type" ? "Type" : "Topic"}</span> Rejected {typeName(rejected.label)}
                            {controls(document, target, version, `${kind} ${typeName(rejected.label)}`)}
                          </span>
                        );
                      })}
                    </div>
                    {document.duplicates.length > 0 ? (
                      <ul className={styles.duplicates} aria-label={`Similar sources to ${nameOf(document.documentId)}`}>
                        {document.duplicates.map((duplicate) => (
                          <li key={`${duplicate.relatedDocumentId}:${duplicate.kind}`}>
                            <span className={styles.badge}>{BADGE[duplicate.badge]}</span> {nameOf(duplicate.relatedDocumentId)}
                            <span className={styles.note}> Compare only. Nothing is deleted; both sources stay.</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </section>
  );
}
