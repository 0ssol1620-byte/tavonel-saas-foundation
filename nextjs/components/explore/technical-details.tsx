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

import { useRef } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "@/components/world-visual/use-dialog-focus";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY, type ExploreAnswerView, type ExploreChangeView, type ExploreTechnicalRecord } from "@/lib/explore-story";

/** `[1..48, 51]` reads as "1–48, 51". A page list is only useful if it can be read. */
function describePages(pages: number[]): string {
  const runs: string[] = [];
  let start = pages[0];
  let previous = pages[0];
  for (const page of pages.slice(1)) {
    if (page === previous + 1) { previous = page; continue; }
    runs.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = page;
    previous = page;
  }
  runs.push(start === previous ? `${start}` : `${start}–${previous}`);
  return runs.join(", ");
}

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
  const panelRef = useRef<HTMLElement | null>(null);
  // Focus enters the drawer, stays in it, and goes back to TECHNICAL DETAILS on Escape (§20).
  useDialogFocus(panelRef);

  return (
    <aside
      ref={panelRef}
      className={styles.drawer}
      role="dialog"
      aria-modal="true"
      aria-label={EXPLORE_COPY.technical}
    >
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
            {/*
              BA-034: the engine is named where the figure is printed, not two pages away. The
              qualifier is one shared string so the sample's three public points of use cannot
              drift into three differently-hedged labels.
            */}
            <div>
              <dt>Objects <small>{EXPLORE_COPY.countsQualifier}</small></dt>
              <dd>{record.counts.objects}</dd>
            </div>
            <div><dt>Relations</dt><dd>{record.counts.relations}</dd></div>
            <div><dt>Evidence regions</dt><dd>{record.counts.regions}</dd></div>
            <div>
              <dt>Sent to this browser</dt>
              <dd>
                {record.shipped.objects} objects · {record.shipped.relations} relations ·{" "}
                {record.shipped.regions} regions
              </dd>
            </div>
          </dl>
          {/*
            §24, said out loud. The compiled World is not the payload, and disclosing that is
            cheaper than letting a reader assume either that the page ships all of it or that it
            compiled only what it ships. Every other figure on this page is the compiler's.
          */}
          <p className={styles.drawerNote}>
            The stage is sent the drawn composition, one relation hop out from it and the source
            regions that composition can open &mdash; not the whole compiled World.
          </p>
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
                  {document.documentId} · {document.compiledPageCount ?? document.pageCount} of{" "}
                  {document.pageCount} page{document.pageCount === 1 ? "" : "s"} compiled ·{" "}
                  {document.regionCount} regions
                  {/*
                    A declared slice is printed as a range, never as forty-nine numbers, and a
                    document compiled in full says so rather than listing eighty of them (§57).
                  */}
                  {document.declaredPages?.length
                    ? ` · declared pages ${describePages(document.declaredPages)}`
                    : " · every page declared"}
                  {/*
                    The acquisition record, for the one reader who will check it (§11.3).

                    A reference render's own digest is above; the original it was rendered from,
                    the render profile that produced it and the SEC accession belong here, so the
                    source sheet can stay a page and the drawer can be the audit trail.
                  */}
                  {document.representationKind === "reference_render" ? (
                    <>
                      <br />
                      reference render of {document.sourceFilename} · {document.originalSha256}
                      <br />
                      render profile: {document.renderProfile}
                    </>
                  ) : null}
                  {/*
                    Where the bytes came from, printed for every filing rather than only for the
                    rendered ones. §11.3 lists the acquisition source beside the digests, and the
                    two documents that differ most here are exactly the two this line separates:
                    an SEC EDGAR primary document and an Apple Investor Relations PDF are not the
                    same provenance even when both are official.
                  */}
                  {document.acquiredFrom ? (
                    <>
                      <br />
                      acquired from: {document.acquiredFrom}
                    </>
                  ) : null}
                  {document.accession ? (
                    <>
                      <br />
                      {document.form} · filed {document.filingDate} · period ended{" "}
                      {document.reportDate} · accession {document.accession} · authority{" "}
                      {document.authority}
                    </>
                  ) : null}
                  {document.sliceRationale ? (
                    <>
                      <br />
                      slice: {document.sliceRationale}
                    </>
                  ) : null}
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
            <div><dt>{change.baseline.label}</dt><dd>{change.baseline.manifestDigest}</dd></div>
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
