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
  label; after a decision this panel offers Undo, which records the opposite decision. Nothing is
  deleted and no source is touched: a decision is one appended row.

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
type Target = { documentId: string; labelKind: "doc_type" | "topic"; labelKey: string };
type Loaded = { documents: LibraryDocument[]; sourceVersions: Record<string, string> };
type Load = { state: "loading" } | { state: "hidden" } | { state: "unavailable" } | ({ state: "ready" } & Loaded);

const BADGE: Record<LibraryDocument["duplicates"][number]["badge"], string> = { exact: "Exact copy", near: "Near copy", revision: "Possible revision" };
const typeName = (label: string) => label.replace(/_/g, " ");
const targetKey = (target: Target) => `${target.documentId}:${target.labelKind}:${target.labelKey}`;
const opposite = (decision: Decision): Decision => (decision === "confirmed" ? "rejected" : "confirmed");

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
  const [decided, setDecided] = useState<Record<string, { target: Target; decision: Decision }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const idsKey = documentIds.join(",");

  const refresh = useCallback(async () => {
    if (idsKey === "") return setLoad({ state: "ready", documents: [], sourceVersions: {} });
    try {
      const response = await api(`/api/library?documents=${encodeURIComponent(idsKey)}`);
      if (response.status === 404) return setLoad({ state: "hidden" });
      const body = await response.json().catch(() => null) as ({ documents?: LibraryDocument[]; sourceVersions?: Record<string, string> }) | null;
      if (!response.ok || !body || !Array.isArray(body.documents) || !body.sourceVersions) return setLoad({ state: "unavailable" });
      setLoad({ state: "ready", documents: body.documents, sourceVersions: body.sourceVersions });
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
      setDecided((current) => {
        const next = { ...current };
        if (isUndo) delete next[key];
        else next[key] = { target, decision };
        return next;
      });
      await refresh();
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

  function controls(target: Target, state: "proposed" | "confirmed", sourceVersionId: string | undefined, label: string) {
    const key = targetKey(target);
    const last = decided[key]?.decision;
    const disabled = busy !== null;
    if (last) {
      return (
        <button type="button" className={styles.action} disabled={disabled} onClick={() => void decide(target, opposite(last), sourceVersionId, true)}
          aria-label={`Undo ${last === "confirmed" ? "confirming" : "rejecting"} ${label}`}>Undo</button>
      );
    }
    return (
      <>
        {state === "proposed" ? (
          <button type="button" className={styles.action} disabled={disabled} onClick={() => void decide(target, "confirmed", sourceVersionId, false)}
            aria-label={`Confirm ${label}`}>Confirm</button>
        ) : null}
        <button type="button" className={styles.action} disabled={disabled} onClick={() => void decide(target, "rejected", sourceVersionId, false)}
          aria-label={`Reject ${label}`}>Reject</button>
      </>
    );
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
                          {controls(typeTarget, type.state === "confirmed" ? "confirmed" : "proposed", version, `type ${typeName(type.label)}`)}
                        </span>
                      ) : <span className={styles.label}><span className={styles.kind}>Type</span> Unknown</span>}
                      {document.topics.map((topic) => (
                        <span key={topic.label} className={styles.label}>
                          <span className={styles.kind}>Topic</span> {topic.label}
                          {controls({ documentId: document.documentId, labelKind: "topic", labelKey: topic.label }, topic.state, version, `topic ${topic.label}`)}
                        </span>
                      ))}
                      {/* A label this session rejected is no longer in the DTO; its Undo stays here, on the document. */}
                      {Object.values(decided)
                        .filter(({ target, decision }) => decision === "rejected" && target.documentId === document.documentId
                          && !(target.labelKind === "doc_type" ? type?.label === target.labelKey : document.topics.some((topic) => topic.label === target.labelKey)))
                        .map(({ target }) => (
                          <span key={targetKey(target)} className={styles.label}>
                            <span className={styles.kind}>{target.labelKind === "doc_type" ? "Type" : "Topic"}</span> Rejected {typeName(target.labelKey)}
                            {controls(target, "confirmed", version, `${target.labelKind === "doc_type" ? "type" : "topic"} ${typeName(target.labelKey)}`)}
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
