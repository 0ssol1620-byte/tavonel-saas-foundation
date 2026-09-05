"use client";

/*
  The drawer §20 asks for: everything the stage deliberately does not show by default.

  Nothing here is new information -- it is the same artifact the acts are drawn from, printed at
  full precision. That is the whole design: a visitor is never made to read a digest, and an
  engineer is never told to trust one. Raw object ids appear only inside this panel, which is
  also the rule the rest of the product follows.

  Code-split. This is the one part of the page most readers never open, and it carries the
  longest strings on it.
*/

import { X } from "lucide-react";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY, type ExploreAnswerView, type ExploreChangeView, type ExploreTechnicalRecord } from "@/lib/explore-story";

export type TechnicalSelection = {
  objectId: string;
  objectKind: string;
  evidenceId: string | null;
  sourceVersionId: string | null;
  bbox1000: [number, number, number, number] | null;
  digest: string | null;
  authority: string | null;
};

export default function TechnicalDetails({
  record,
  selection,
  change,
  answer,
  onClose,
}: {
  record: ExploreTechnicalRecord;
  selection: TechnicalSelection | null;
  change: ExploreChangeView;
  answer: ExploreAnswerView | null;
  onClose: () => void;
}) {
  return (
    <aside className={styles.drawer} role="dialog" aria-label={EXPLORE_COPY.technical}>
      <header>
        <span>{EXPLORE_COPY.technical}</span>
        <button type="button" onClick={onClose} aria-label="Close technical details">
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.drawerBody}>
        <section>
          <h3>World</h3>
          <dl>
            <div><dt>World id</dt><dd>{record.worldId}</dd></div>
            <div><dt>Status</dt><dd>{record.worldStatus}</dd></div>
            <div><dt>Manifest digest</dt><dd>{record.manifestDigest}</dd></div>
            <div><dt>Objects</dt><dd>{record.counts.objects}</dd></div>
            <div><dt>Relations</dt><dd>{record.counts.relations}</dd></div>
            <div><dt>Evidence regions</dt><dd>{record.counts.regions}</dd></div>
          </dl>
        </section>

        <section>
          <h3>Execution</h3>
          <dl>
            <div><dt>Runtime</dt><dd>{record.runtime}</dd></div>
            <div><dt>Request</dt><dd>{record.receipt.requestId}</dd></div>
            <div><dt>Input sha256</dt><dd>{record.receipt.inputSha256}</dd></div>
            <div><dt>Output sha256</dt><dd>{record.receipt.outputSha256}</dd></div>
            <div><dt>Source directory</dt><dd>{record.sourceDirectory}</dd></div>
          </dl>
          <p className={styles.drawerNote}>
            This sample is compiled by this repository&rsquo;s TypeScript collection compiler at
            build time over committed files, not dispatched to the Core runtime. The runtime name
            above says which one ran.
          </p>
        </section>

        {selection ? (
          <section>
            <h3>Selection</h3>
            <dl>
              <div><dt>Object id</dt><dd>{selection.objectId}</dd></div>
              <div><dt>Kind</dt><dd>{selection.objectKind}</dd></div>
              <div><dt>Evidence id</dt><dd>{selection.evidenceId ?? "—"}</dd></div>
              <div><dt>Source version</dt><dd>{selection.sourceVersionId ?? "—"}</dd></div>
              <div><dt>Bbox (per mille)</dt><dd>{selection.bbox1000 ? selection.bbox1000.join(", ") : "—"}</dd></div>
              <div><dt>Source sha256</dt><dd>{selection.digest ?? "—"}</dd></div>
              <div><dt>Authority</dt><dd>{selection.authority ?? "—"}</dd></div>
            </dl>
          </section>
        ) : null}

        <section>
          <h3>Sources</h3>
          <dl>
            {record.documents.map((document) => (
              <div key={document.documentId}>
                <dt>{document.filename}</dt>
                <dd>
                  {document.digest}
                  <br />
                  {document.documentId} · {document.pageCount} page
                  {document.pageCount === 1 ? "" : "s"} · {document.regionCount} regions
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3>Revisions</h3>
          <dl>
            {record.revisions.map((revision) => (
              <div key={revision.id}>
                <dt>{revision.label}</dt>
                <dd>{revision.status} · {revision.manifestDigest}</dd>
              </div>
            ))}
            <div><dt>{change.before.label}</dt><dd>{change.before.manifestDigest}</dd></div>
            <div><dt>{change.after.label}</dt><dd>{change.after.manifestDigest}</dd></div>
          </dl>
          <p className={styles.drawerNote}>
            {change.equivalence.state === "receipt"
              ? `Equivalence receipt ${change.equivalence.source} · ${change.equivalence.sha256}`
              : change.equivalence.reason}
          </p>
        </section>

        {answer ? (
          <section>
            <h3>Retrieval</h3>
            <dl>
              {answer.regions.map((region) => (
                <div key={region.evidenceId}>
                  <dt>{region.evidenceId}</dt>
                  <dd>relevance {region.relevance.toFixed(6)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section>
          <h3>Entity labels in this sample</h3>
          <p className={styles.drawerNote}>{EXPLORE_COPY.entityDisclaimer}</p>
        </section>
      </div>
    </aside>
  );
}
