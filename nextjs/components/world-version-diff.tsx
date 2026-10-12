"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { countChanges, diffWorldVersions, type FieldChange, type WorldVersionDiff } from "@/lib/world-version-diff";
import type { ReviewImpactContract, WorldReadModel } from "@/lib/world-read-model";
import {
  DEFAULT_DIFF_FILTERS, DIFF_CATEGORIES, DIFF_CATEGORY_LABELS, DIFF_KINDS,
  deriveWorldVersionDiffView, paginateWorldVersionDiffView, evidenceDiffLabel, objectDiffLabel, relationDiffLabel,
  type DiffFilters, type WorldVersionDiffView, type WorldVersionDiffPage,
} from "@/lib/world-version-diff-view";
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
  // Bind both the artifact and its request state to the render that requested them.
  const [comparison, setComparison] = useState<{
    model: WorldReadModel;
    digest: string;
    worldId: string;
    currentDigest: string;
    other: WorldReadModel | null;
    state: "idle" | "loading" | "unavailable";
  } | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[] | null>(null);
  /*
    Changed only, on by default (audit U03).

    The comparison was already change-only in substance -- it lists added, removed and changed
    records and never the identical ones -- but it still printed a heading and a "No objects
    differ." line for every section that had nothing in it, so a one-field change arrived
    surrounded by five paragraphs saying nothing happened. This hides those empty sections.

    It is a display filter over a comparison that has already been made, and the control stays
    on screen while it is on: a reader who wants the whole shape of the comparison, including
    what did not move, turns it off. Nothing is hidden that the toggle cannot bring back.
  */
  const [changedOnly, setChangedOnly] = useState(true);
  const [filters, setFilters] = useState<DiffFilters>(DEFAULT_DIFF_FILTERS);
  const filterId = useId();
  // Bind display paging to the exact filtered comparison; a changed input starts at page one
  // synchronously, including the render before passive comparison effects run.
  const [pageSelection, setPageSelection] = useState<{ diff: WorldVersionDiff; filters: DiffFilters; page: number } | null>(null);

  // Default to the version immediately before the one on screen, which is the comparison
  // someone almost always wants and the one a rollback would actually perform.
  useEffect(() => {
    const candidates = versions.filter((entry) => entry.manifestDigest !== current);
    setLeftDigest((previous) => candidates.some((entry) => entry.manifestDigest === previous) ? previous : candidates[0]?.manifestDigest ?? null);
  }, [versions, current]);

  useEffect(() => {
    if (!model || !leftDigest) { setComparison(null); return; }
    let cancelled = false;
    const request = { model, digest: leftDigest, worldId: model.world.id, currentDigest: model.world.manifestDigest };
    setComparison({ ...request, other: null, state: "loading" });
    void (async () => {
      const token = await authToken();
      if (!token) { if (!cancelled) setComparison({ ...request, other: null, state: "unavailable" }); return; }
      const response = await fetch(
        `/api/v1/world/${model.world.id}?manifest=${encodeURIComponent(leftDigest)}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const body = await response.json().catch(() => ({})) as { model?: WorldReadModel };
      if (cancelled) return;
      if (!response.ok || !body.model || body.model.world.id !== model.world.id || body.model.world.manifestDigest !== leftDigest) { setComparison({ ...request, other: null, state: "unavailable" }); return; }
      setComparison({ ...request, other: body.model, state: "idle" });
    })().catch(() => { if (!cancelled) setComparison({ ...request, other: null, state: "unavailable" }); });
    return () => { cancelled = true; };
  }, [model, leftDigest]);

  useEffect(() => {
    if (!model) { setDecisions(null); return; }
    let cancelled = false;
    setDecisions(null);
    void (async () => {
      const token = await authToken();
      if (!token) return;
      const response = await fetch(`/api/v1/reviews?collectionId=${encodeURIComponent(model.world.id)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { decisions?: ReviewDecision[] };
      if (!cancelled && response.ok) setDecisions(body.decisions ?? []);
    })().catch(() => { if (!cancelled) setDecisions([]); });
    return () => { cancelled = true; };
  }, [model]);

  // Selection and model changes hide old results immediately, before passive effects run.
  const selectedComparison = comparison && comparison.model === model && comparison.digest === leftDigest
    && comparison.worldId === model?.world.id && comparison.currentDigest === current
    && leftDigest !== current ? comparison : null;
  const other = selectedComparison?.other ?? null;
  const state = selectedComparison?.state ?? (model && leftDigest && leftDigest !== current ? "loading" : "idle");
  const diff = useMemo(
    () => (model && other ? diffWorldVersions(other, model) : null),
    [model, other],
  );
  const view = useMemo(() => diff ? deriveWorldVersionDiffView(diff, filters) : null, [diff, filters]);

  const page = useMemo(() => view ? paginateWorldVersionDiffView(view,
    pageSelection && pageSelection.diff === diff && pageSelection.filters === filters ? pageSelection.page : 1) : null,
  [view, diff, filters, pageSelection]);

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

      {diff && view && page ? (
        <>
          <p className={styles.summary}>
            <code>{diff.left.manifestDigest.slice(7, 19)}</code> → <code>{diff.right.manifestDigest.slice(7, 19)}</code>
            {" · "}
            {diff.identical ? "identical" : `${countChanges(diff)} change${countChanges(diff) === 1 ? "" : "s"}`}
          </p>

          <label className={styles.note}>
            <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
            {" "}Changed only — hide the sections with no difference
          </label>

          <fieldset className={styles.filters} aria-describedby={`${filterId}-help`}>
            <legend>Filter artifact changes</legend>
            <label>
              <span>Category</span>
              <select value={filters.category} onChange={(event) => setFilters((previous) => ({ ...previous, category: event.target.value as DiffFilters["category"] }))}>
                <option value="all">All categories</option>
                {DIFF_CATEGORIES.map((category) => <option key={category} value={category}>{DIFF_CATEGORY_LABELS[category]}</option>)}
              </select>
            </label>
            <label>
              <span>Change kind</span>
              <select value={filters.kind} onChange={(event) => setFilters((previous) => ({ ...previous, kind: event.target.value as DiffFilters["kind"] }))}>
                <option value="all">All change kinds</option>
                {DIFF_KINDS.map((kind) => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}
              </select>
            </label>
            <label className={styles.search}>
              <span>Find a change</span>
              <input type="search" value={filters.text} placeholder="ID, label, path or changed value" onChange={(event) => setFilters((previous) => ({ ...previous, text: event.target.value }))} />
            </label>
            <button type="button" disabled={!view.filtering} onClick={() => { setFilters(DEFAULT_DIFF_FILTERS); setPageSelection(null); }}>Clear filters</button>
            <p id={`${filterId}-help`} className={styles.note}>Filters apply to artifact rows. Review decisions and rollback cover the complete comparison.</p>
          </fieldset>

          <ArtifactDiffSections view={view} page={page} changedOnly={changedOnly} unchangedRevisions={diff.sourceRevisions.unchanged} />
          <nav className={styles.pagination} aria-label="Artifact change pages">
            <button type="button" disabled={page.page === 1} onClick={() => setPageSelection({ diff, filters, page: page.page - 1 })}>Previous changes</button>
            <span>Page {page.page} of {page.pageCount}</span>
            <button type="button" disabled={page.page === page.pageCount} onClick={() => setPageSelection({ diff, filters, page: page.page + 1 })}>Next changes</button>
          </nav>

          <VersionComparisonEffects impact={model.review.impact} />

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
                Rolling back to <code>{leftDigest.slice(7, 19)}</code> reverses the entire version comparison: all {countChanges(diff)} artifact changes, including rows hidden by filters.
              </p>
              <button type="button" disabled={rollbackBusy} onClick={() => onRollback(diff.left.manifestDigest)}>
                {rollbackBusy ? "Rolling back…" : "Roll back to this version"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function VersionComparisonEffects({ impact }: { impact: ReviewImpactContract }) {
  return (
    <p className={styles.note}>
      Merge, split, bridge and ACL effects: unknown (not_yet; not materialized in this comparison).
      {" "}Answer-cache effects: unknown (not_yet). {impact.answerCaches.state === "not_yet"
        ? impact.answerCaches.reason
        : "The review impact contract does not establish cache effects for this version comparison."}
    </p>
  );
}

/** These counts and rows consume the same selection; the ledger is deliberately outside it. */
export function ArtifactDiffSections({ view, page, changedOnly, unchangedRevisions }: {
  view: WorldVersionDiffView;
  page?: WorldVersionDiffPage;
  changedOnly: boolean;
  unchangedRevisions: number;
}) {
  const groups = page?.groups ?? view.groups;
  const displayed = page?.displayed ?? view.visible;
  return (
    <>
      <p className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
        Showing {displayed.total} of {view.original.total} artifact changes
        {page ? <> · Rows {page.start}–{page.end} of {view.visible.total} matching changes</> : null}
        {" · "}{displayed.kinds.added} added · {displayed.kinds.removed} removed · {displayed.kinds.changed} changed
      </p>
      {view.visible.total === 0 ? (
        <p className={styles.note}>{view.original.total === 0 ? "No artifact changes in this comparison." : "No artifact changes match these filters. Clear filters to see the complete comparison."}</p>
      ) : null}
      <DiffSection title="Objects" category="objects" group={groups.objects} render={objectDiffLabel} changedOnly={changedOnly} originalTotal={view.original.categories.objects} matchingTotal={page ? view.visible.categories.objects : undefined} />
      <DiffSection title="Relations" category="relations" group={groups.relations} render={relationDiffLabel} changedOnly={changedOnly} originalTotal={view.original.categories.relations} matchingTotal={page ? view.visible.categories.relations : undefined} />
      <DiffSection title="Evidence" category="evidence" group={groups.evidence} render={evidenceDiffLabel} changedOnly={changedOnly} originalTotal={view.original.categories.evidence} matchingTotal={page ? view.visible.categories.evidence : undefined} />
      <StringDiffSection title="Package files" category="files" group={groups.files} changedOnly={changedOnly} originalTotal={view.original.categories.files} matchingTotal={page ? view.visible.categories.files : undefined} />
      <StringDiffSection title="Source revisions" category="sourceRevisions" group={groups.sourceRevisions} changedOnly={changedOnly} originalTotal={view.original.categories.sourceRevisions} matchingTotal={page ? view.visible.categories.sourceRevisions : undefined} note={`${unchangedRevisions} unchanged in the complete comparison`} />
    </>
  );
}

function StringDiffSection({ title, category, group, changedOnly, originalTotal, matchingTotal, note }: {
  title: string;
  category: string;
  group: { added: string[]; removed: string[]; changed: string[] };
  changedOnly: boolean;
  originalTotal: number;
  matchingTotal?: number;
  note?: string;
}) {
  const total = group.added.length + group.removed.length + group.changed.length;
  if (changedOnly && total === 0) return null;
  return (
    <section data-diff-category={category}>
      <h4>{title} <span className={styles.sectionCount}>{matchingTotal === undefined ? `${total} of ${originalTotal}` : `${total} displayed · ${matchingTotal} matching · ${originalTotal} complete`}</span></h4>
      {note ? <p className={styles.note}>{note}</p> : null}
      {total === 0 ? (
        <p className={styles.note}>{matchingTotal ? `No ${title.toLowerCase()} on this page.` : originalTotal === 0 ? `No ${title.toLowerCase()} differ.` : `No ${title.toLowerCase()} match these filters.`}</p>
      ) : (
        <ul className={styles.plain}>
          {DIFF_KINDS.flatMap((kind) => group[kind].map((item) => (
            <li key={`${kind}:${item}`} data-diff-row="true" data-record-id={item} data-kind={kind}>
              {kind === "added" ? "+" : kind === "removed" ? "−" : "~"} {item}
            </li>
          )))}
        </ul>
      )}
    </section>
  );
}

export function DiffSection<T extends { id: string; changes: FieldChange[] }>({ title, group, render, changedOnly, originalTotal, matchingTotal, category }: {
  title: string;
  group: { added: T[]; removed: T[]; changed: T[] };
  render: (item: T) => string;
  changedOnly?: boolean;
  originalTotal?: number;
  matchingTotal?: number;
  category?: string;
}) {
  const total = group.added.length + group.removed.length + group.changed.length;
  if (changedOnly && total === 0) return null;
  return (
    <section data-diff-category={category}>
      <h4>{title}{originalTotal !== undefined ? <span className={styles.sectionCount}> {matchingTotal === undefined ? `${total} of ${originalTotal}` : `${total} displayed · ${matchingTotal} matching · ${originalTotal} complete`}</span> : null}</h4>
      {total === 0 ? (
        <p className={styles.note}>{matchingTotal ? `No ${title.toLowerCase()} on this page.` : originalTotal ? `No ${title.toLowerCase()} match these filters.` : `No ${title.toLowerCase()} differ.`}</p>
      ) : (
        <ul className={styles.plain}>
          {group.added.map((item) => <li key={`+${item.id}`} data-diff-row="true" data-record-id={item.id} data-kind="added">+ {render(item)}</li>)}
          {group.removed.map((item) => <li key={`-${item.id}`} data-diff-row="true" data-record-id={item.id} data-kind="removed">− {render(item)}</li>)}
          {group.changed.map((item) => (
            <li key={`~${item.id}`} data-diff-row="true" data-record-id={item.id} data-kind="changed">
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
