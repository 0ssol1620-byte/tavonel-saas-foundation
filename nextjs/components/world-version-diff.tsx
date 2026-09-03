"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { countChanges, diffWorldVersions, type FieldChange } from "@/lib/world-version-diff";
import type { WorldReadModel } from "@/lib/world-read-model";
import styles from "./world-version-diff.module.css";

/*
  What you are about to undo.

  The Versions lens listed versions. That is a history, and it answers the wrong question for
  the person standing in front of it: someone considering a rollback wants to know what
  changes back, not how many versions exist. Masterplan 11 asks for the comparison -- objects,
  properties, relations, evidence, review decisions and source revisions -- and asks for it
  before the rollback rather than as a record afterwards.

  Both sides are loaded from the API by manifest digest, so the comparison is between two
  compiled artifacts rather than between the current one and a remembered summary of another.
*/

type ReviewDecision = {
  decisionId: string;
  manifestDigest: string;
  evidenceId: string;
  action: "accept" | "edit" | "reject";
  reason: string;
  recordedAt: string;
  patch: { objectId: string; before: string; after: string; resultingManifestDigest: string } | null;
};

type Props = {
  model: WorldReadModel | null;
  /** Rendered as the confirmation step of a rollback when the host provides one. */
  onRollback?: (manifestDigest: string) => void;
  rollbackBusy?: boolean;
};

async function authToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

export default function WorldVersionDiffPanel({ model, onRollback, rollbackBusy }: Props) {
  // Memoised because it is an effect dependency: `?? []` is a fresh array on every render,
  // which would re-run the default-selection effect forever.
  const versions = useMemo(() => model?.history ?? [], [model]);
  const current = model?.world.manifestDigest ?? null;
  const [leftDigest, setLeftDigest] = useState<string | null>(null);
  const [other, setOther] = useState<WorldReadModel | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "unavailable">("idle");

  // Default to the version immediately before the one on screen, which is the comparison
  // someone almost always wants and the one a rollback would actually perform.
  useEffect(() => {
    const candidates = versions.filter((entry) => entry.manifestDigest !== current);
    setLeftDigest((previous) => previous ?? candidates[0]?.manifestDigest ?? null);
  }, [versions, current]);

  useEffect(() => {
    if (!model || !leftDigest) { setOther(null); return; }
    let cancelled = false;
    setState("loading");
    void (async () => {
      const token = await authToken();
      if (!token) { if (!cancelled) setState("unavailable"); return; }
      const response = await fetch(
        `/api/v1/world/${model.world.id}?manifest=${encodeURIComponent(leftDigest)}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const body = await response.json().catch(() => ({})) as { model?: WorldReadModel };
      if (cancelled) return;
      if (!response.ok || !body.model) { setState("unavailable"); setOther(null); return; }
      setOther(body.model);
      setState("idle");
    })();
    return () => { cancelled = true; };
  }, [model, leftDigest]);

  useEffect(() => {
    if (!model) { setDecisions(null); return; }
    let cancelled = false;
    void (async () => {
      const token = await authToken();
      if (!token) return;
      const response = await fetch(`/api/v1/reviews?collectionId=${encodeURIComponent(model.world.id)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { decisions?: ReviewDecision[] };
      if (!cancelled && response.ok) setDecisions(body.decisions ?? []);
    })();
    return () => { cancelled = true; };
  }, [model]);

  const diff = useMemo(
    () => (model && other ? diffWorldVersions(other, model) : null),
    [model, other],
  );

  if (!model || versions.length === 0) {
    return (
      <section className={styles.empty} role="status">
        <span>READ_NOT_YET</span>
        <h3>No persisted World history is available</h3>
        <p>A version comparison needs two compiled candidates to compare.</p>
      </section>
    );
  }

  const relevantDecisions = (decisions ?? []).filter((decision) =>
    decision.manifestDigest === leftDigest
    || decision.manifestDigest === current
    || decision.patch?.resultingManifestDigest === current);

  return (
    <div className={styles.panel}>
      <ol className={styles.versions}>
        {versions.map((entry) => (
          <li key={`${entry.version}:${entry.manifestDigest}`} data-current={entry.manifestDigest === current}>
            <span className={styles.status}>{entry.status}</span>
            <strong>{entry.version}</strong>
            <code>{entry.manifestDigest.slice(7, 19)}</code>
            <small>
              {entry.activatedAt.state === "read" ? entry.activatedAt.value : "not activated"}
            </small>
            {entry.manifestDigest === current ? (
              <em>on screen</em>
            ) : (
              <button type="button" onClick={() => setLeftDigest(entry.manifestDigest)} aria-pressed={entry.manifestDigest === leftDigest}>
                Compare
              </button>
            )}
          </li>
        ))}
      </ol>

      {state === "loading" ? <p className={styles.note}>Reading the other version…</p> : null}
      {state === "unavailable" ? (
        <p className={styles.note} role="status">
          That version&rsquo;s artifact could not be read, so there is nothing to compare against. Nothing was changed.
        </p>
      ) : null}

      {diff ? (
        <>
          <p className={styles.summary}>
            <code>{diff.left.manifestDigest.slice(7, 19)}</code> → <code>{diff.right.manifestDigest.slice(7, 19)}</code>
            {" · "}
            {diff.identical ? "identical" : `${countChanges(diff)} change${countChanges(diff) === 1 ? "" : "s"}`}
          </p>

          <Section title="Objects" group={diff.objects} render={(item) => `${item.type} · ${item.label}`} />
          <Section title="Relations" group={diff.relations} render={(item) => `${item.subject} ${item.predicate} ${item.object}`} />
          <Section title="Evidence" group={diff.evidence} render={(item) => `${item.sourceId} p.${item.page}`} />

          <section>
            <h4>Package files</h4>
            {diff.files.added.length + diff.files.removed.length + diff.files.changed.length === 0 ? (
              <p className={styles.note}>No package file differs.</p>
            ) : (
              <ul className={styles.plain}>
                {diff.files.added.map((path) => <li key={`+${path}`} data-kind="added">+ {path}</li>)}
                {diff.files.removed.map((path) => <li key={`-${path}`} data-kind="removed">− {path}</li>)}
                {diff.files.changed.map((path) => <li key={`~${path}`} data-kind="changed">~ {path}</li>)}
              </ul>
            )}
          </section>

          <section>
            <h4>Source revisions</h4>
            <p className={styles.note}>
              {diff.sourceRevisions.unchanged} unchanged
              {diff.sourceRevisions.added.length > 0 ? ` · ${diff.sourceRevisions.added.length} added` : ""}
              {diff.sourceRevisions.removed.length > 0 ? ` · ${diff.sourceRevisions.removed.length} removed` : ""}
            </p>
          </section>

          <section>
            <h4>Review decisions</h4>
            {relevantDecisions.length === 0 ? (
              <p className={styles.note}>
                {decisions === null ? "Reading the decision ledger…" : "No decision has been recorded against either version."}
              </p>
            ) : (
              <ul className={styles.decisions}>
                {relevantDecisions.map((decision) => (
                  <li key={decision.decisionId} data-action={decision.action}>
                    <span>{decision.action}</span>
                    <strong>{decision.reason}</strong>
                    {decision.patch ? (
                      <code>
                        {decision.patch.before} → {decision.patch.after}
                      </code>
                    ) : null}
                    <small>{decision.recordedAt}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {onRollback && leftDigest && !diff.identical ? (
            <div className={styles.rollback}>
              {/*
                The confirmation is the diff above it. A rollback button with nothing but a
                version number next to it asks someone to approve a change they cannot see.
              */}
              <p className={styles.note}>
                Rolling back to <code>{leftDigest.slice(7, 19)}</code> reverses every change listed above.
              </p>
              <button type="button" disabled={rollbackBusy} onClick={() => onRollback(leftDigest)}>
                {rollbackBusy ? "Rolling back…" : "Roll back to this version"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Section<T extends { id: string; changes: FieldChange[] }>({ title, group, render }: {
  title: string;
  group: { added: T[]; removed: T[]; changed: T[] };
  render: (item: T) => string;
}) {
  const total = group.added.length + group.removed.length + group.changed.length;
  return (
    <section>
      <h4>{title}</h4>
      {total === 0 ? (
        <p className={styles.note}>No {title.toLowerCase()} differ.</p>
      ) : (
        <ul className={styles.plain}>
          {group.added.map((item) => <li key={`+${item.id}`} data-kind="added">+ {render(item)}</li>)}
          {group.removed.map((item) => <li key={`-${item.id}`} data-kind="removed">− {render(item)}</li>)}
          {group.changed.map((item) => (
            <li key={`~${item.id}`} data-kind="changed">
              ~ {render(item)}
              <ul className={styles.fields}>
                {item.changes.map((change) => (
                  <li key={change.field}>
                    <b>{change.field}</b>
                    <s>{change.before || "—"}</s>
                    <ins>{change.after || "—"}</ins>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
