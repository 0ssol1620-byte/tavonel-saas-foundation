"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import PdfEvidenceViewer from "@/components/pdf-evidence-viewer";
import WorldGraphCanvas from "@/components/world-graph-canvas";
import WorldDirectoryTree from "@/components/world-directory-tree";
import WorldOntologyViewer from "@/components/world-ontology-viewer";
import WorldVersionDiffPanel from "@/components/world-version-diff";
import type { SelectedWorldEvidence, WorldEvidence, WorldReadModel } from "@/lib/world-read-model";
import styles from "./world-studio-ultimate.module.css";

export type WorldStudioLens = "overview" | "graph" | "directory" | "ontology" | "evidence" | "versions" | "files";

type Props = {
  model: WorldReadModel | null;
  initialLens?: WorldStudioLens;
  selectedEvidenceId?: string | null;
  onEvidenceSelect?: (selection: SelectedWorldEvidence | null) => void;
  onRollback?: (manifestDigest: string) => void;
  rollbackBusy?: boolean;
};

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
  return <section className={styles.notYet} role="status"><span>EMPTY</span><h3>{title}</h3><p>{children}</p></section>;
}

function EvidenceCard({ evidence, selected, onSelect }: { evidence: WorldEvidence; selected: boolean; onSelect: (evidence: WorldEvidence) => void }) {
  return (
    <button type="button" className={styles.evidenceCard} data-sensitive="content" data-selected={selected} aria-pressed={selected} onClick={() => onSelect(evidence)}>
      <span>{evidence.sourceId} / p.{evidence.page}</span><strong>{evidence.excerpt}</strong><small>BBOX [{evidence.bbox.join(", ")}]</small>
    </button>
  );
}

export default function WorldStudioUltimate({ model, initialLens = "overview", selectedEvidenceId, onEvidenceSelect, onRollback, rollbackBusy }: Props) {
  const [lens, setLens] = useState<WorldStudioLens>(initialLens);
  const [localEvidenceId, setLocalEvidenceId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<{ url: string; state: "ready" | "loading" | "unavailable" } | null>(null);
  const activeEvidenceId = selectedEvidenceId === undefined ? localEvidenceId : selectedEvidenceId;
  const selection = selectWorldEvidence(model, activeEvidenceId);
  const selectedObject = model?.objects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedSourceId = selection?.sourceId ?? null;
  const selectedSourceVersionId = selection?.sourceVersionId ?? null;
  const selectedSourcePage = selection?.page ?? null;

  useEffect(() => { setLens(initialLens); }, [initialLens]);

  useEffect(() => {
    if (!selectedSourceId || !selectedSourceVersionId || !selectedSourcePage) { setSourcePreview(null); return; }
    let cancelled = false;
    setSourcePreview({ url: "", state: "loading" });
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) { if (!cancelled) setSourcePreview({ url: "", state: "unavailable" }); return; }
      const response = await fetch(`/api/documents/${selectedSourceId}/source?version=${encodeURIComponent(selectedSourceVersionId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { readUrl?: string };
      if (!cancelled) setSourcePreview(response.ok && body.readUrl ? { url: body.readUrl, state: "ready" } : { url: "", state: "unavailable" });
    })();
    return () => { cancelled = true; };
  }, [selectedSourceId, selectedSourceVersionId, selectedSourcePage]);

  const selectEvidence = (evidence: WorldEvidence) => {
    if (selectedEvidenceId === undefined) setLocalEvidenceId(evidence.id);
    onEvidenceSelect?.(selectWorldEvidence(model, evidence.id));
  };
  const clearEvidence = () => { if (selectedEvidenceId === undefined) setLocalEvidenceId(null); onEvidenceSelect?.(null); };

  const overview = useMemo(() => {
    if (!model) return null;
    const sourcedObjects = model.objects.filter((object) => object.evidenceRefs.length > 0).length;
    const evidenceCoverage = model.objects.length > 0 ? Math.round((sourcedObjects / model.objects.length) * 100) : 0;
    const sources = new Set(model.evidence.map((item) => item.sourceId)).size;
    return { sourcedObjects, evidenceCoverage, sources };
  }, [model]);

  return (
    <section className={styles.studio} aria-labelledby="world-studio-title">
      <header className={styles.header}>
        <div><span>COMPILED WORLD</span><h2 id="world-studio-title">World Studio</h2><p>Inspect the current World first, then open the graph, directory, ontology or exact source evidence when you need the detail.</p></div>
        <dl>
          <div><dt>STATE</dt><dd>{model?.world.status.toUpperCase() ?? "NOT READY"}</dd></div>
          <div><dt>SOURCES</dt><dd>{overview?.sources ?? "--"}</dd></div>
          <div><dt>OBJECTS</dt><dd>{model ? model.objects.length : "--"}</dd></div>
          <div><dt>RELATIONS</dt><dd>{model ? model.relations.length : "--"}</dd></div>
        </dl>
      </header>

      <nav className={styles.lenses} role="tablist" aria-label="World lenses">
        {LENSES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={lens === item.id} aria-controls={`world-lens-${item.id}`} onClick={() => setLens(item.id)}>{item.label}</button>)}
      </nav>

      <div className={styles.workspace} data-lens={lens}>
        <div id={`world-lens-${lens}`} className={styles.lensBody} role="tabpanel">
          {lens === "overview" && (
            !model || !overview ? <EmptyState title="No World yet">Compile sources and review a candidate to create a World you can inspect here.</EmptyState> : (
              <div className={styles.overview}>
                <div className={styles.overviewMetrics}>
                  <article><span>SOURCES</span><strong>{overview.sources}</strong><p>documents represented by page-bound evidence</p></article>
                  <article><span>OBJECTS</span><strong>{model.objects.length}</strong><p>compiled semantic objects</p></article>
                  <article><span>RELATIONS</span><strong>{model.relations.length}</strong><p>persisted connections between objects</p></article>
                  <article><span>EVIDENCE COVERAGE</span><strong>{overview.evidenceCoverage}%</strong><p>{overview.sourcedObjects} of {model.objects.length} objects carry evidence</p></article>
                </div>
                <div className={styles.overviewActions}>
                  <button type="button" onClick={() => setLens("graph")}><b>See relationships</b><span>Open Graph →</span></button>
                  <button type="button" onClick={() => setLens("evidence")}><b>Verify the source</b><span>Open Evidence →</span></button>
                  <button type="button" onClick={() => setLens("versions")}><b>Understand changes</b><span>Open Versions →</span></button>
                </div>
              </div>
            )
          )}

          {lens === "graph" && <WorldGraphCanvas model={model} selectedObjectId={selectedObjectId} onObjectSelect={setSelectedObjectId} onEvidenceSelect={(evidenceId) => { const evidence = model?.evidence.find((item) => item.id === evidenceId); if (evidence) selectEvidence(evidence); }} />}
          {lens === "directory" && <WorldDirectoryTree entries={model?.directory ?? []} objects={model?.objects ?? []} selectedObjectId={selectedObjectId} onObjectSelect={setSelectedObjectId} />}
          {lens === "ontology" && <WorldOntologyViewer ontology={model?.ontology ?? null} />}
          {lens === "evidence" && (!model || model.evidence.length === 0 ? <EmptyState title="No evidence yet">Compile a World to inspect the exact page and region behind its objects.</EmptyState> : <div className={styles.evidenceGrid}>{model.evidence.map((evidence) => <EvidenceCard key={evidence.id} evidence={evidence} selected={selection?.id === evidence.id} onSelect={selectEvidence} />)}</div>)}
          {lens === "versions" && <WorldVersionDiffPanel model={model} onRollback={onRollback} rollbackBusy={rollbackBusy} />}
          {lens === "files" && (!model || model.files.length === 0 ? <EmptyState title="No package files yet">A compiled package appears here after a World is available.</EmptyState> : <ul className={styles.fileList} data-sensitive="content">{model.files.map((file) => <li key={file.path}><strong>{file.path}</strong><span>{file.mediaType}</span><small>{file.sizeBytes.toLocaleString()} B</small><code>{file.sha256}</code></li>)}</ul>)}
        </div>

        <aside className={styles.inspector} aria-label="World selection inspector">
          {selection ? (
            <><div className={styles.inspectorTitle}><span>SELECTED EVIDENCE</span><button type="button" onClick={clearEvidence}>Clear</button></div><strong>{selection.sourceId}</strong><dl><div><dt>PAGE</dt><dd>{selection.page}</dd></div><div><dt>BBOX</dt><dd>[{selection.bbox.join(", ")}]</dd></div></dl><div className={styles.pagePreview} aria-label={`Actual source page ${selection.page} with evidence bounding box`}>{sourcePreview?.state === "ready" ? <PdfEvidenceViewer url={sourcePreview.url} page={selection.page} bbox={selection.bbox} label={`Source ${selection.sourceId}, page ${selection.page}, exact evidence region`} /> : <span>{sourcePreview?.state === "loading" ? "Opening source page…" : `Preview unavailable · page ${selection.page}`}</span>}</div></>
          ) : selectedObject ? (
            <><div className={styles.inspectorTitle}><span>SELECTED OBJECT</span></div><strong data-sensitive="content">{selectedObject.label}</strong><dl><div><dt>TYPE</dt><dd>{selectedObject.type}</dd></div><div><dt>STATE</dt><dd>{selectedObject.readState === "read" ? "READY" : "NEEDS REVIEW"}</dd></div><div><dt>RELATIONS</dt><dd>{selectedObject.relations.length}</dd></div><div><dt>EVIDENCE</dt><dd>{selectedObject.evidenceRefs.length}</dd></div></dl></>
          ) : lens === "overview" ? (
            <div className={styles.inspectorHint}><span>WORLD OVERVIEW</span><p>Select Graph, Directory, Ontology or Evidence when you want to inspect an individual object.</p></div>
          ) : <EmptyState title="Nothing selected">Select a compiled object or evidence record to inspect it here.</EmptyState>}
        </aside>
      </div>
    </section>
  );
}
