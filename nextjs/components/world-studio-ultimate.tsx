"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import PdfEvidenceViewer from "@/components/pdf-evidence-viewer";
import WorldGraphCanvas from "@/components/world-graph-canvas";
import WorldDirectoryTree from "@/components/world-directory-tree";
import WorldOntologyViewer from "@/components/world-ontology-viewer";
import WorldVersionDiffPanel from "@/components/world-version-diff";
import type { SelectedWorldEvidence, WorldEvidence, WorldReadModel } from "@/lib/world-read-model";
import { readWorldLensParams, writeWorldLensParams } from "@/lib/world-lens-url";
import { datesRecorded, filterBySourceRevision, sourceRevisions, versionOptions } from "@/lib/world-temporal-view";
import styles from "./world-studio-ultimate.module.css";

export type WorldStudioLens = "overview" | "graph" | "directory" | "ontology" | "evidence" | "versions" | "files";

type SourcePreview = { sourceId: string; versionId: string } & (
  | { state: "ready"; bytes: Uint8Array }
  | { state: "loading"; retry?: boolean }
  | { state: "unavailable" }
);

type Props = {
  model: WorldReadModel | null;
  initialLens?: WorldStudioLens;
  selectedEvidenceId?: string | null;
  onEvidenceSelect?: (selection: SelectedWorldEvidence | null) => void;
  onRollback?: (manifestDigest: string) => void;
  rollbackBusy?: boolean;
  /* Mirror lens, selection, version and source revision into the address bar, and read them back on load. */
  syncUrl?: boolean;
};

/* What the stat strip prints before there is anything to count. Not "--", and not "0":
   a count of zero and a count nobody has taken are different facts. */
const NOT_YET = "not yet";
const LENSES: Array<{ id: WorldStudioLens; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Graph" },
  { id: "directory", label: "Directory" },
  { id: "ontology", label: "Ontology" },
  { id: "evidence", label: "Evidence" },
  { id: "versions", label: "Versions" },
  { id: "files", label: "Files" },
];

function selectWorldEvidence(model: WorldReadModel | null, evidenceId: string | null): SelectedWorldEvidence | null {
  if (!model || !evidenceId) return null;
  const evidence = model.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return null;
  return { id: evidence.id, sourceId: evidence.sourceId, sourceVersionId: evidence.sourceVersionId, page: evidence.page, bbox: [...evidence.bbox], blockId: evidence.blockId, digest: evidence.digest };
}

function EmptyState({ title, children }: { title: string; children: string }) {
  return <section className={styles.notYet} role="status"><span>Empty</span><h3>{title}</h3><p>{children}</p></section>;
}

function EvidenceCard({ evidence, selected, onSelect }: { evidence: WorldEvidence; selected: boolean; onSelect: (evidence: WorldEvidence) => void }) {
  return (
    <button type="button" className={styles.evidenceCard} data-sensitive="content" data-selected={selected} aria-pressed={selected} onClick={() => onSelect(evidence)}>
      <span>{evidence.sourceId} / p.{evidence.page}</span><strong>{evidence.excerpt}</strong><small>Region [{evidence.bbox.join(", ")}]</small>
    </button>
  );
}

async function authToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

export default function WorldStudioUltimate({ model: currentModel, initialLens = "overview", selectedEvidenceId, onEvidenceSelect, onRollback, rollbackBusy, syncUrl = false }: Props) {
  const [asOf, setAsOf] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [past, setPast] = useState<{ digest: string; model: WorldReadModel } | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [urlRead, setUrlRead] = useState(!syncUrl);
  const currentDigest = currentModel?.world.manifestDigest ?? null;
  const worldId = currentModel?.world.id ?? null;
  const pastView = past && past.digest === asOf ? past.model : null;
  const viewingPast = asOf !== null && asOf !== currentDigest;
  // The model on screen: a historical version when one is chosen, narrowed to a source revision when one is.
  const viewed = pastView ?? currentModel;
  const model = useMemo(() => (viewed && revision ? filterBySourceRevision(viewed, revision) : viewed), [viewed, revision]);
  const [lens, setLens] = useState<WorldStudioLens>(initialLens);
  const [localEvidenceId, setLocalEvidenceId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  /* Bumped by Retry so the same source/version is read again; a page change never touches it. */
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const activeEvidenceId = selectedEvidenceId === undefined ? localEvidenceId : selectedEvidenceId;
  // Only the exact id asked for. An id this model does not hold stays unresolved, never a neighbour.
  const selection = model?.evidence.find((item) => item.id === activeEvidenceId) ?? null;
  const selectedObject = model?.objects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedSourceId = selection?.sourceId ?? null;
  const selectedSourceVersionId = selection?.sourceVersionId ?? null;
  const currentPreview = sourcePreview?.sourceId === selectedSourceId && sourcePreview?.versionId === selectedSourceVersionId ? sourcePreview : null;
  const previewBusy = !currentPreview || currentPreview.state === "loading";
  // A retry keeps its control in place, so the keyboard never loses it while the read is in flight.
  const previewRetryable = currentPreview?.state === "unavailable" || (currentPreview?.state === "loading" && currentPreview.retry === true);
  const evidenceHeadingRef = useRef<HTMLSpanElement>(null);
  const focusEvidenceHeading = useRef(false);

  useEffect(() => { setLens(initialLens); }, [initialLens]);

  // Read the address bar once, after mount, so server and first client render agree.
  const latest = useRef({ syncUrl, selectedEvidenceId, currentModel, onEvidenceSelect });
  latest.current = { syncUrl, selectedEvidenceId, currentModel, onEvidenceSelect };
  useEffect(() => {
    const { syncUrl, selectedEvidenceId, currentModel, onEvidenceSelect } = latest.current;
    if (!syncUrl) return;
    const params = readWorldLensParams(new URLSearchParams(window.location.search));
    if (params.lens) setLens(params.lens);
    if (params.object) setSelectedObjectId(params.object);
    if (params.evidence) { if (selectedEvidenceId === undefined) setLocalEvidenceId(params.evidence); else { const picked = selectWorldEvidence(currentModel, params.evidence); if (picked) onEvidenceSelect?.(picked); } }
    if (params.asOf) setAsOf(params.asOf);
    if (params.revision) setRevision(params.revision);
    setUrlRead(true);
  }, []);
  useEffect(() => {
    if (!syncUrl || !urlRead) return;
    const url = writeWorldLensParams(new URL(window.location.href), { lens, object: selectedObjectId ?? undefined, evidence: activeEvidenceId ?? undefined, asOf: asOf ?? undefined, revision: revision ?? undefined });
    window.history.replaceState(window.history.state, "", url);
  }, [syncUrl, urlRead, lens, selectedObjectId, activeEvidenceId, asOf, revision]);

  // A chosen older version is fetched whole and shown read-only; a failed read leaves the current World and drops asof.
  useEffect(() => {
    if (!asOf || !worldId || asOf === currentDigest) { setPast(null); return; }
    const controller = new AbortController();
    void (async () => {
      const token = await authToken();
      if (!token) throw new Error("NO_SESSION");
      const response = await fetch(`/api/v1/world/${worldId}?manifest=${encodeURIComponent(asOf)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({})) as { model?: WorldReadModel };
      if (!response.ok || !body.model || body.model.world.id !== worldId || body.model.world.manifestDigest !== asOf) throw new Error("VERSION_UNAVAILABLE");
      setVersionError(false);
      setPast({ digest: asOf, model: body.model });
    })().catch(() => { if (controller.signal.aborted) return; setPast(null); setVersionError(true); setAsOf(null); });
    return () => controller.abort();
  }, [asOf, currentDigest, worldId]);
  // Only once the control that asked has left the DOM: focus the reader moved elsewhere is never taken.
  useEffect(() => {
    if (!focusEvidenceHeading.current || !evidenceHeadingRef.current) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    focusEvidenceHeading.current = false;
    evidenceHeadingRef.current.focus();
  }, [selection, currentPreview?.state]);
  // Evidence chosen from outside (a controlled parent) replaces an object selection too.
  useEffect(() => { if (activeEvidenceId) setSelectedObjectId(null); }, [activeEvidenceId]);

  useEffect(() => {
    if (!selectedSourceId || !selectedSourceVersionId) { setSourcePreview(null); return; }
    let cancelled = false;
    const controller = new AbortController();
    const identity = { sourceId: selectedSourceId, versionId: selectedSourceVersionId };
    // An in-flight read of this same source (a Retry) keeps its state, including the retry flag.
    setSourcePreview((previous) => previous?.state === "loading" && previous.sourceId === identity.sourceId && previous.versionId === identity.versionId ? previous : { ...identity, state: "loading" });
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (cancelled) return;
      if (!token) { setSourcePreview({ ...identity, state: "unavailable" }); return; }
      const response = await fetch(`/api/documents/${encodeURIComponent(selectedSourceId)}/source?version=${encodeURIComponent(selectedSourceVersionId)}&format=pdf`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("SOURCE_PREVIEW_UNAVAILABLE");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;
      setSourcePreview({ ...identity, bytes, state: "ready" });
    })().catch(() => { if (!cancelled) setSourcePreview({ ...identity, state: "unavailable" }); });
    return () => { cancelled = true; controller.abort(); };
  }, [selectedSourceId, selectedSourceVersionId, previewAttempt]);

  const selectEvidence = (evidence: WorldEvidence) => {
    setSelectedObjectId(null);
    if (selectedEvidenceId === undefined) setLocalEvidenceId(evidence.id);
    onEvidenceSelect?.(selectWorldEvidence(model, evidence.id));
  };
  const retryPreview = () => {
    if (currentPreview?.state !== "unavailable") return;
    focusEvidenceHeading.current = true;
    setSourcePreview({ sourceId: currentPreview.sourceId, versionId: currentPreview.versionId, state: "loading", retry: true });
    setPreviewAttempt((attempt) => attempt + 1);
  };
  const clearEvidence = () => { if (selectedEvidenceId === undefined) setLocalEvidenceId(null); onEvidenceSelect?.(null); };
  const selectObject = (objectId: string | null) => {
    setSelectedObjectId(objectId);
    if (activeEvidenceId) clearEvidence();
  };

  const overview = useMemo(() => {
    if (!model) return null;
    const sourcedObjects = model.objects.filter((object) => object.evidenceRefs.length > 0).length;
    const evidenceCoverage = model.objects.length > 0 ? Math.round((sourcedObjects / model.objects.length) * 100) : 0;
    const sources = new Set(model.evidence.map((item) => item.sourceId)).size;
    return { sourcedObjects, evidenceCoverage, sources };
  }, [model]);

  const pastEntry = viewingPast && pastView ? currentModel?.history.find((entry) => entry.manifestDigest === asOf) : undefined;
  const pastState = pastEntry?.status ?? "superseded";

  return (
    <section className={styles.studio} aria-labelledby="world-studio-title">
      <header className={styles.header}>
        <div><span className="eyebrow">{!model ? "World not loaded" : viewingPast && pastView ? `Version ${pastEntry?.version ?? ""} · ${pastState}` : model.world.status === "candidate" ? "Compiled candidate" : "Compiled World"}</span><h2 id="world-studio-title">World Studio</h2><p>{!model ? "A readable compiled model appears here when one is available." : viewingPast && pastView ? `Viewing version ${pastEntry?.version ?? ""} · not the current World` : model.world.status === "candidate" ? "Inspect this candidate before activation, then open its graph, directory, ontology or source evidence." : "Inspect the current World first, then open the graph, directory, ontology or exact source evidence when you need the detail."}</p></div>
        <dl>
          <div><dt>State</dt><dd>{model ? (viewingPast && pastView ? pastState : model.world.status) : "Not compiled"}</dd></div>
          <div><dt>Sources</dt><dd>{overview ? overview.sources : NOT_YET}</dd></div>
          <div><dt>Objects</dt><dd>{model ? model.objects.length : NOT_YET}</dd></div>
          <div><dt>Relations</dt><dd>{model ? model.relations.length : NOT_YET}</dd></div>
        </dl>
      </header>

      <nav className={styles.lenses} role="tablist" aria-label="World lenses">
        {LENSES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={lens === item.id} aria-controls={`world-lens-${item.id}`} onClick={() => setLens(item.id)}>{item.label}</button>)}
      </nav>

      {currentModel && (
        <div className={styles.filters}>
          <label>View as of
            <select value={viewingPast ? asOf ?? "" : currentDigest ?? ""} onChange={(event) => { setVersionError(false); setAsOf(event.target.value === currentDigest ? null : event.target.value); }}>
              {versionOptions(currentModel.history, currentModel.world.manifestDigest).map((option) => <option key={option.manifestDigest} value={option.manifestDigest}>{`Version ${option.version}${option.current ? " (current)" : ""}`}</option>)}
            </select>
          </label>
          <label>Source revision
            <select value={revision ?? ""} onChange={(event) => setRevision(event.target.value || null)}>
              <option value="">All source revisions</option>
              {[...new Set([...sourceRevisions(viewed ?? currentModel), ...(revision ? [revision] : [])])].map((rev) => <option key={rev} value={rev}>{rev}</option>)}
            </select>
          </label>
          {viewingPast && <p role="status">{pastView ? `Viewing version ${currentModel.history.find((entry) => entry.manifestDigest === asOf)?.version ?? pastView.history.find((entry) => entry.manifestDigest === asOf)?.version ?? ""} · not the current World` : "Opening that version…"}</p>}
          {versionError && <p role="alert">That version could not be read. The current World is shown.</p>}
          {!datesRecorded(currentModel) && <p>Per-object dates are not recorded in this World; filter by version or source revision.</p>}
        </div>
      )}

      <div className={styles.workspace} data-lens={lens}>
        <div id={`world-lens-${lens}`} className={styles.lensBody} role="tabpanel">
          {lens === "overview" && (
            !model || !overview ? <EmptyState title="No World yet">Compile sources and review a candidate to create a World you can inspect here.</EmptyState> : (
              <div className={styles.overview}>
                <div className={styles.overviewMetrics}>
                  <article><span>Sources</span><strong>{overview.sources}</strong><p>documents represented by page-bound evidence</p></article>
                  <article><span>Objects</span><strong>{model.objects.length}</strong><p>compiled semantic objects</p></article>
                  <article><span>Relations</span><strong>{model.relations.length}</strong><p>persisted connections between objects</p></article>
                  <article><span>Evidence coverage</span><strong>{overview.evidenceCoverage}%</strong><p>{overview.sourcedObjects} of {model.objects.length} objects carry evidence</p></article>
                </div>
                <div className={styles.overviewActions}>
                  <button type="button" onClick={() => setLens("graph")}><b>See relationships</b><span>Open graph</span></button>
                  <button type="button" onClick={() => setLens("evidence")}><b>Verify the source</b><span>Open evidence</span></button>
                  <button type="button" onClick={() => setLens("versions")}><b>Understand changes</b><span>Open versions</span></button>
                </div>
              </div>
            )
          )}

          {lens === "graph" && <WorldGraphCanvas model={model} selectedObjectId={selectedObjectId} onObjectSelect={selectObject} onEvidenceSelect={(evidenceId) => { const evidence = model?.evidence.find((item) => item.id === evidenceId); if (evidence) selectEvidence(evidence); }} />}
          {lens === "directory" && <WorldDirectoryTree entries={model?.directory ?? []} objects={model?.objects ?? []} selectedObjectId={selectedObjectId} onObjectSelect={selectObject} />}
          {lens === "ontology" && <WorldOntologyViewer ontology={model?.ontology ?? null} />}
          {lens === "evidence" && (!model || model.evidence.length === 0 ? <EmptyState title="No evidence yet">Compile a World to inspect the exact page and region behind its objects.</EmptyState> : <div className={styles.evidenceGrid}>{model.evidence.map((evidence) => <EvidenceCard key={evidence.id} evidence={evidence} selected={selection?.id === evidence.id} onSelect={selectEvidence} />)}</div>)}
          {lens === "versions" && <WorldVersionDiffPanel model={viewed} onRollback={viewingPast ? undefined : onRollback} rollbackBusy={rollbackBusy} />}
          {lens === "files" && (!model || model.files.length === 0 ? <EmptyState title="No package files yet">A compiled package appears here after a World is available.</EmptyState> : <ul className={styles.fileList} data-sensitive="content">{model.files.map((file) => <li key={file.path}><strong>{file.path}</strong><span>{file.mediaType}</span><small>{file.sizeBytes.toLocaleString()} B</small><code>{file.sha256}</code></li>)}</ul>)}
        </div>

        <aside className={styles.inspector} aria-label="World selection inspector">
          {selection ? (
            <><div className={styles.inspectorTitle}><span ref={evidenceHeadingRef} role="heading" aria-level={3} tabIndex={-1}>Selected evidence</span><button type="button" onClick={clearEvidence}>Clear</button></div><strong>{selection.sourceId}</strong><dl><div><dt>Version</dt><dd>{selection.sourceVersionId}</dd></div><div><dt>Page</dt><dd>{selection.page}</dd></div><div><dt>Region</dt><dd>[{selection.bbox.join(", ")}]</dd></div></dl><blockquote className={styles.excerpt} data-sensitive="content">{selection.excerpt}</blockquote><div className={styles.pagePreview} aria-label={`Actual source page ${selection.page} with evidence bounding box`}>{currentPreview?.state === "ready" ? <PdfEvidenceViewer key={JSON.stringify([selection.sourceId, selection.sourceVersionId, selection.page])} data={currentPreview.bytes} page={selection.page} bbox={selection.bbox} label={`Source ${selection.sourceId}, page ${selection.page}, exact evidence region`} /> : <span><span role="status" aria-busy={previewBusy}>{previewBusy ? "Opening source page…" : `Preview unavailable · page ${selection.page}`}</span>{previewRetryable && <button type="button" aria-disabled={previewBusy} onClick={retryPreview}>Retry</button>}</span>}</div></>
          ) : activeEvidenceId && model ? (
            <><div className={styles.inspectorTitle}><span>Selected evidence</span><button type="button" onClick={clearEvidence}>Clear</button></div><EmptyState title="Evidence not in this revision">{`${activeEvidenceId} is not part of ${revision ? "this source revision" : "this compiled World"}, so no source page is shown.`}</EmptyState></>
          ) : selectedObject ? (
            <><div className={styles.inspectorTitle}><span>Selected object</span></div><strong data-sensitive="content">{selectedObject.label}</strong><dl><div><dt>Type</dt><dd>{selectedObject.type}</dd></div><div><dt>State</dt><dd>{selectedObject.readState === "read" ? "READY" : "NEEDS REVIEW"}</dd></div><div><dt>Relations</dt><dd>{selectedObject.relations.length}</dd></div><div><dt>Evidence</dt><dd>{selectedObject.evidenceRefs.length}</dd></div></dl>
              <div className={styles.objectEvidence} role="group" aria-label="Evidence bound to this object">
                {selectedObject.evidenceRefs.length === 0 ? <p>No evidence is bound to this object.</p> : (
                  <ul>{selectedObject.evidenceRefs.map((ref, index) => {
                    const evidence = model?.evidence.find((item) => item.id === ref);
                    return <li key={`${ref}-${index}`}>{evidence
                      ? <button type="button" aria-label={`Open evidence ${ref}, ${evidence.sourceId} page ${evidence.page}`} onClick={() => { focusEvidenceHeading.current = true; selectEvidence(evidence); }}><b>{ref}</b><small>{evidence.sourceId} · p.{evidence.page}</small></button>
                      : <p data-state="unresolved"><b>{ref}</b><small>{revision ? "Not in this source revision; no source is shown." : "Not in this compiled World; no source is shown."}</small></p>}</li>;
                  })}</ul>
                )}
              </div></>
          ) : lens === "overview" ? (
            <div className={styles.inspectorHint}><span>World overview</span><p>Select Graph, Directory, Ontology or Evidence when you want to inspect an individual object.</p></div>
          ) : <EmptyState title="Nothing selected">Select a compiled object or evidence record to inspect it here.</EmptyState>}
        </aside>
      </div>
    </section>
  );
}
