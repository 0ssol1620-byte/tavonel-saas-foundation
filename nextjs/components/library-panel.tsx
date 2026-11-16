"use client";

import { useCallback, useEffect, useState } from "react";
import { displayName, type DocumentNames } from "@/lib/document-names";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { LibraryDocument } from "@/lib/library-shadow";
import styles from "./library-panel.module.css";

/*
  The Library (WO-D23-4): what the compiler proposed for each source, with Unknown kept visible.

  Three groups by what a person can rely on: Confirmed (a person said so), Proposed (the compiler
  said so), Unknown (it declined to propose, or has not looked). A person confirms or rejects a
  label; after a decision this panel offers Undo, which records the opposite decision, for as long as
  the Library shows what that decision did. Nothing is deleted and no source is touched: a decision
  is one appended row.

  When the Library is not enabled for this workspace the route answers 404 and this renders nothing.
  When it cannot be read it says so and shows no documents -- never a partial list.
*/

type Props = {
  documentIds: readonly string[];
  names: DocumentNames;
  /** Tells the page whether the Library exists for this workspace, so it can show or hide its entry. */
  onAvailability?: (available: boolean) => void;
};
type Decision = "confirmed" | "rejected";
export type Target = { documentId: string; labelKind: "doc_type" | "topic"; labelKey: string };
export type SessionDecisions = Readonly<Record<string, { target: Target; decision: Decision }>>;
type Loaded = { documents: LibraryDocument[]; sourceVersions: Record<string, string> };
type Load = { state: "loading" } | { state: "hidden" } | { state: "unavailable" } | ({ state: "ready" } & Loaded);

const BADGE: Record<LibraryDocument["duplicates"][number]["badge"], string> = { exact: "Exact copy", near: "Near copy", revision: "Possible revision" };
const typeName = (label: string) => label.replace(/_/g, " ");
export const targetKey = (target: Target) => `${target.documentId}:${target.labelKind}:${target.labelKey}`;
export const opposite = (decision: Decision): Decision => (decision === "confirmed" ? "rejected" : "confirmed");

/** What the Library shows for one label of one document now; null when it shows no such label. */
export function shownState(document: LibraryDocument, target: Target): "confirmed" | "proposed" | null {
  if (target.labelKind === "doc_type") return document.documentType?.label === target.labelKey ? document.documentType.state : null;
  return document.topics.find((topic) => topic.label === target.labelKey)?.state ?? null;
}

/*
  The controls are chosen from what the Library shows, never from what this session remembers alone. Undo is
  the opposite decision, and the store folds a decision after its opposite into a withdrawal, so a decision can
  land as something other than what it said (a Reject of a label confirmed on another visit withdraws that
  confirmation, and the proposal speaks again). A session decision therefore offers Undo only while the Library
  shows exactly what it did: a confirmation shows the label confirmed, a rejection shows no such label.
  Otherwise the label gets the ordinary controls for what it shows, and the session forgets that decision.
*/
const showsWhatItDid = (decision: Decision, shown: ReturnType<typeof shownState>) => (decision === "confirmed" ? shown === "confirmed" : shown === null);

export type LabelControl = "confirm" | "reject" | "undo";
export function labelControls(shown: ReturnType<typeof shownState>, session: Decision | undefined): LabelControl[] {
  if (session && showsWhatItDid(session, shown)) return ["undo"];
  return shown === "proposed" ? ["confirm", "reject"] : shown === "confirmed" ? ["reject"] : [];
}

/** The session after a saved decision and a fresh read: an Undo forgets the decision; one the Library does not show is dropped. */
export function nextSession(current: SessionDecisions, saved: { target: Target; decision: Decision; isUndo: boolean } | null,
  documents: readonly LibraryDocument[]): SessionDecisions {
  const next: Record<string, { target: Target; decision: Decision }> = { ...current };
  if (saved) {
    if (saved.isUndo) delete next[targetKey(saved.target)];
    else next[targetKey(saved.target)] = { target: saved.target, decision: saved.decision };
  }
  for (const [key, { target, decision }] of Object.entries(next)) {
    const document = documents.find((candidate) => candidate.documentId === target.documentId);
    if (!document || !showsWhatItDid(decision, shownState(document, target))) delete next[key];
  }
  return next;
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

function groupOf(document: LibraryDocument): "confirmed" | "proposed" | "unknown" {
  const type = document.documentType;
  return type?.state === "confirmed" ? "confirmed" : type?.state === "proposed" ? "proposed" : "unknown";
}

export default function LibraryPanel({ documentIds, names, onAvailability }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // What this browser session decided, so Undo can offer the opposite; keyed by label. The target is kept because a
  // rejected label leaves the DTO, and its Undo must still be reachable from the document's row.
  const [decided, setDecided] = useState<SessionDecisions>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const idsKey = documentIds.join(",");

  // A read after a saved decision reconciles the session with what the Library now shows (nextSession).
  const refresh = useCallback(async (saved: Parameters<typeof nextSession>[1] = null) => {
    if (idsKey === "") return setLoad({ state: "ready", documents: [], sourceVersions: {} });
    try {
      const response = await api(`/api/library?documents=${encodeURIComponent(idsKey)}`);
      if (response.status === 404) return setLoad({ state: "hidden" });
      const body = await response.json().catch(() => null) as ({ documents?: LibraryDocument[]; sourceVersions?: Record<string, string> }) | null;
      if (!response.ok || !body || !Array.isArray(body.documents) || !body.sourceVersions) return setLoad({ state: "unavailable" });
      const documents = body.documents;
      setDecided((current) => nextSession(current, saved, documents));
      setLoad({ state: "ready", documents, sourceVersions: body.sourceVersions });
    } catch {
      setLoad({ state: "unavailable" });
    }
  }, [idsKey]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (load.state === "hidden") onAvailability?.(false);
    else if (load.state === "ready") onAvailability?.(true);
  }, [load.state, onAvailability]);

  async function decide(target: Target, decision: Decision, sourceVersionId: string | undefined, isUndo: boolean) {
    if (!sourceVersionId) return setProblem("This source has no recorded version to decide on yet.");
    const key = targetKey(target);
    setBusy(key);
    setProblem(null);
    try {
      const response = await api("/api/library/decisions", { method: "POST",
        body: JSON.stringify({ ...target, sourceVersionId, decision, idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) {
        // Nothing changed on the server, so nothing changes here: the panel keeps what it showed.
        setProblem(response.status === 403 ? "You can not decide on this source." : "The decision was not saved. Nothing changed. Try again.");
        return;
      }
      await refresh({ target, decision, isUndo });
    } catch {
      setProblem("The decision was not saved. Nothing changed. Try again.");
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
    const last = decided[targetKey(target)]?.decision;
    const disabled = busy !== null;
    return labelControls(shownState(document, target), last).map((control) => (control === "undo" && last ? (
      <button key={control} type="button" className={styles.action} disabled={disabled} onClick={() => void decide(target, opposite(last), sourceVersionId, true)}
        aria-label={`Undo ${last === "confirmed" ? "confirming" : "rejecting"} ${label}`}>Undo</button>
    ) : control === "confirm" ? (
      <button key={control} type="button" className={styles.action} disabled={disabled} onClick={() => void decide(target, "confirmed", sourceVersionId, false)}
        aria-label={`Confirm ${label}`}>Confirm</button>
    ) : (
      <button key={control} type="button" className={styles.action} disabled={disabled} onClick={() => void decide(target, "rejected", sourceVersionId, false)}
        aria-label={`Reject ${label}`}>Reject</button>
    )));
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
                      {/* A label this session rejected is no longer in the DTO; its Undo stays here, on the document. */}
                      {Object.values(decided)
                        .filter(({ target, decision }) => decision === "rejected" && target.documentId === document.documentId && shownState(document, target) === null)
                        .map(({ target }) => (
                          <span key={targetKey(target)} className={styles.label}>
                            <span className={styles.kind}>{target.labelKind === "doc_type" ? "Type" : "Topic"}</span> Rejected {typeName(target.labelKey)}
                            {controls(document, target, version, `${target.labelKind === "doc_type" ? "type" : "topic"} ${typeName(target.labelKey)}`)}
                          </span>
                        ))}
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
