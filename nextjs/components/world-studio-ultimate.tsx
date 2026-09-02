"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import PdfEvidenceViewer from "@/components/pdf-evidence-viewer";
import type {
  SelectedWorldEvidence,
  WorldEvidence,
  WorldReadModel,
} from "@/lib/world-read-model";
import styles from "./world-studio-ultimate.module.css";

export type WorldStudioLens = "graph" | "directory" | "ontology" | "evidence" | "versions" | "files";

type Props = {
  model: WorldReadModel | null;
  initialLens?: WorldStudioLens;
  selectedEvidenceId?: string | null;
  onEvidenceSelect?: (selection: SelectedWorldEvidence | null) => void;
};

const LENSES: Array<{ id: WorldStudioLens; label: string }> = [
  { id: "graph", label: "Graph" },
  { id: "directory", label: "Directory" },
  { id: "ontology", label: "Ontology" },
  { id: "evidence", label: "Evidence" },
  { id: "versions", label: "Versions" },
  { id: "files", label: "Files" },
];

function selectWorldEvidence(
  model: WorldReadModel | null,
  evidenceId: string | null,
): SelectedWorldEvidence | null {
  if (!model || !evidenceId) return null;
  const evidence = model.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return null;
  return {
    id: evidence.id,
    sourceId: evidence.sourceId,
    sourceVersionId: evidence.sourceVersionId,
    page: evidence.page,
    bbox: [...evidence.bbox],
    blockId: evidence.blockId,
    digest: evidence.digest,
  };
}

function ReadNotYet({ children }: { children: string }) {
  return (
    <section className={styles.notYet} role="status">
      <span>READ_NOT_YET</span>
      <h3>No compiled record to read</h3>
      <p>{children}</p>
    </section>
  );
}

function EvidenceCard({ evidence, selected, onSelect }: {
  evidence: WorldEvidence;
  selected: boolean;
  onSelect: (evidence: WorldEvidence) => void;
}) {
  return (
    <button
      type="button"
      className={styles.evidenceCard}
      data-sensitive="content"
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(evidence)}
    >
      <span>{evidence.sourceId} / p.{evidence.page}</span>
      <strong>{evidence.excerpt}</strong>
      <small>BBOX [{evidence.bbox.join(", ")}]</small>
    </button>
  );
}

export default function WorldStudioUltimate({
  model,
  initialLens = "graph",
  selectedEvidenceId,
  onEvidenceSelect,
}: Props) {
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

  useEffect(() => {
    if (!selectedSourceId || !selectedSourceVersionId || !selectedSourcePage) { setSourcePreview(null); return; }
    let cancelled = false;
    setSourcePreview({ url: "", state: "loading" });
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) { if (!cancelled) setSourcePreview({ url: "", state: "unavailable" }); return; }
      const response = await fetch(`/api/documents/${selectedSourceId}/source?version=${encodeURIComponent(selectedSourceVersionId)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { readUrl?: string };
      if (!cancelled) setSourcePreview(response.ok && body.readUrl ? { url: body.readUrl, state: "ready" } : { url: "", state: "unavailable" });
    })();
    return () => { cancelled = true; };
  }, [selectedSourceId, selectedSourceVersionId, selectedSourcePage]);

  const selectEvidence = (evidence: WorldEvidence) => {
    if (selectedEvidenceId === undefined) setLocalEvidenceId(evidence.id);
    onEvidenceSelect?.(selectWorldEvidence(model, evidence.id));
  };

  const clearEvidence = () => {
    if (selectedEvidenceId === undefined) setLocalEvidenceId(null);
    onEvidenceSelect?.(null);
  };

  return (
    <section className={styles.studio} aria-labelledby="world-studio-title">
      <header className={styles.header}>
        <div>
          <span>COMPILED WORLD / READ SURFACE</span>
          <h2 id="world-studio-title">World Studio</h2>
          <p>Only compiled objects, relations, evidence, versions, and package files are shown.</p>
        </div>
        <dl>
          <div><dt>WORLD</dt><dd>{model?.world.id ?? "READ_NOT_YET"}</dd></div>
          <div><dt>STATE</dt><dd>{model?.world.status.toUpperCase() ?? "READ_NOT_YET"}</dd></div>
          <div><dt>OBJECTS</dt><dd>{model ? model.objects.length : "--"}</dd></div>
          <div><dt>RELATIONS</dt><dd>{model ? model.relations.length : "--"}</dd></div>
        </dl>
      </header>

      <nav className={styles.lenses} role="tablist" aria-label="World lenses">
        {LENSES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={lens === item.id}
            aria-controls={`world-lens-${item.id}`}
            onClick={() => setLens(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className={styles.workspace}>
        <div id={`world-lens-${lens}`} className={styles.lensBody} role="tabpanel">
          {lens === "graph" && (
            !model || model.objects.length === 0 ? (
              <ReadNotYet>Compile and validate a collection before its object map can be read.</ReadNotYet>
            ) : (
              <div className={styles.mapLens}>
                <div className={styles.objectGrid} data-sensitive="content">
                  {model.objects.map((object) => (
                    <button
                      key={object.id}
                      type="button"
                      data-selected={selectedObject?.id === object.id}
                      onClick={() => setSelectedObjectId(object.id)}
                    >
                      <span>{object.type}</span>
                      <strong>{object.label}</strong>
                      <small>{object.evidenceRefs.length} evidence / {object.relations.length} relations</small>
                    </button>
                  ))}
                </div>
                {model.relations.length === 0 ? (
                  <ReadNotYet>No compiled relations are present in this World.</ReadNotYet>
                ) : (
                  <ol className={styles.relationList} data-sensitive="content" aria-label="Compiled relations">
                    {model.relations.map((relation) => (
                      <li key={relation.id}>
                        <code>{relation.subject}</code>
                        <b>{relation.predicate}</b>
                        <code>{relation.object}</code>
                        <span>{relation.evidenceRefs.length} evidence</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )
          )}

          {lens === "directory" && (
            !model || model.objects.length === 0 ? (
              <ReadNotYet>No compiled objects are available for the directory lens.</ReadNotYet>
            ) : (
              <div className={styles.directoryTree} data-sensitive="content" aria-label="Compiled semantic directory">
                <strong>Knowledge</strong>
                {[...new Set(model.objects.map((object) => object.type))].sort().map((type) => (
                  <section key={type}>
                    <h3>{type}</h3>
                    <ul>{model.objects.filter((object) => object.type === type).map((object) => (
                      <li key={object.id}><button type="button" onClick={() => setSelectedObjectId(object.id)}>{object.label}</button><span>{object.evidenceRefs.length} evidence</span></li>
                    ))}</ul>
                  </section>
                ))}
              </div>
            )
          )}

          {lens === "ontology" && (
            !model || model.objects.length === 0 ? (
              <ReadNotYet>No compiled object types or relation predicates are available.</ReadNotYet>
            ) : (
              <div className={styles.mapLens}>
                <div className={styles.objectGrid}>
                  {[...new Set(model.objects.map((object) => object.type))].sort().map((type) => (
                    <article key={type}>
                      <span>OBJECT TYPE</span>
                      <strong>{type}</strong>
                      <small>{model.objects.filter((object) => object.type === type).length} compiled objects</small>
                    </article>
                  ))}
                </div>
                {model.relations.length === 0 ? (
                  <ReadNotYet>No compiled relation predicates are present in this World.</ReadNotYet>
                ) : (
                  <ol className={styles.relationList} data-sensitive="content" aria-label="Compiled ontology predicates">
                    {[...new Set(model.relations.map((relation) => relation.predicate))].sort().map((predicate) => (
                      <li key={predicate}>
                        <b>{predicate}</b>
                        <span>{model.relations.filter((relation) => relation.predicate === predicate).length} relations</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )
          )}

          {lens === "evidence" && (
            !model || model.evidence.length === 0 ? (
              <ReadNotYet>No page-and-bbox-bound compiled evidence is available.</ReadNotYet>
            ) : (
              <div className={styles.evidenceGrid}>
                {model.evidence.map((evidence) => (
                  <EvidenceCard key={evidence.id} evidence={evidence} selected={selection?.id === evidence.id} onSelect={selectEvidence} />
                ))}
              </div>
            )
          )}

          {lens === "versions" && (
            !model || model.history.length === 0 ? (
              <ReadNotYet>No persisted World history is available.</ReadNotYet>
            ) : (
              <ol className={styles.historyList}>
                {model.history.map((entry) => (
                  <li key={`${entry.version}:${entry.manifestDigest}`}>
                    <span>{entry.status}</span><strong>{entry.version}</strong>
                    <small>{entry.activatedAt.state === "read" ? entry.activatedAt.value : "ACTIVATION READ_NOT_YET"}</small>
                  </li>
                ))}
              </ol>
            )
          )}

          {lens === "files" && (
            !model || model.files.length === 0 ? (
              <ReadNotYet>No compiled package files are available.</ReadNotYet>
            ) : (
              <ul className={styles.fileList} data-sensitive="content">
                {model.files.map((file) => (
                  <li key={file.path}><strong>{file.path}</strong><span>{file.mediaType}</span><small>{file.sizeBytes.toLocaleString()} B</small><code>{file.sha256}</code></li>
                ))}
              </ul>
            )
          )}
        </div>

        <aside className={styles.inspector} aria-label="World selection inspector">
          {selection ? (
            <>
              <div className={styles.inspectorTitle}><span>SELECTED EVIDENCE</span><button type="button" onClick={clearEvidence}>Clear</button></div>
              <strong>{selection.sourceId}</strong>
              <dl>
                <div><dt>PAGE</dt><dd>{selection.page}</dd></div>
                <div><dt>BBOX</dt><dd>[{selection.bbox.join(", ")}]</dd></div>
              </dl>
              <div className={styles.pagePreview} aria-label={`Actual source page ${selection.page} with evidence bounding box`}>
                {sourcePreview?.state === "ready" ? (
                  <PdfEvidenceViewer
                    url={sourcePreview.url}
                    page={selection.page}
                    bbox={selection.bbox}
                    label={`Source ${selection.sourceId}, page ${selection.page}, exact evidence region`}
                  />
                ) : <span>{sourcePreview?.state === "loading" ? "Opening source page…" : `Source preview unavailable · p.${selection.page}`}</span>}
              </div>
            </>
          ) : selectedObject ? (
            <>
              <div className={styles.inspectorTitle}><span>SELECTED OBJECT</span></div>
              <strong data-sensitive="content">{selectedObject.label}</strong>
              <dl>
                <div><dt>TYPE</dt><dd>{selectedObject.type}</dd></div>
                <div><dt>STATE</dt><dd>{selectedObject.readState === "read" ? "READ" : "READ_NOT_YET"}</dd></div>
                <div><dt>RELATIONS</dt><dd>{selectedObject.relations.length}</dd></div>
                <div><dt>EVIDENCE</dt><dd>{selectedObject.evidenceRefs.length}</dd></div>
              </dl>
            </>
          ) : (
            <ReadNotYet>Select a compiled object or page-bound evidence record to inspect it.</ReadNotYet>
          )}
        </aside>
      </div>
    </section>
  );
}
