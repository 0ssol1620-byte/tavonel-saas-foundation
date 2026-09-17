"use client";

/*
  The source sheet: one region of one page of one filing, staged in the order the handoff asks for.

    1. the source page, whole and readable;
    2. the region cut out of that same render;
    3. the passage the compiler read from that region;
    4. the ledger that lets a reader check all three.

  BQ-014. It used to be a two-tab control opening on the parsed text, which put the extracted text
  and the page it came from on the same footing and showed the page only to a reader who clicked.
  A block whose whole claim is "this is the real source" has to open on the real source. The tabs
  are gone: the page is both the first and the largest thing here, and the text is what follows
  from it. OriginalSourcePage still renders hash-checked bytes; extracted text is never passed off
  as a page image.

  BQ-074. One locator, printed once -- under the page frame. It used to be printed five times in
  this one block: the header, the region map, the page caption, the provenance row and the footer.
*/
import Link from "next/link";
import type { Route } from "next";
import OriginalSourcePage from "./original-source-page";
import styles from "./world-visual.module.css";
import type { VisualEvidence } from "@/lib/visual-world-model";
import { proofCopy } from "@/lib/proof-copy";
import { sameSourcePage } from "@/lib/source-page-geometry";
import { sourcePageQualifier, sourceRegionRaster } from "@/lib/source-page-rasters";

export default function SourceSheet({ regions, activeId, onSelectRegion, ledger = "open", korean }: {
  regions: VisualEvidence[];
  activeId: string;
  onSelectRegion?: (id: string) => void;
  /*
    BQ-070. The sha256 ledger is a real capability, and a decoration when it is printed six times
    across a landing page, so a marketing route gets it as a disclosure and the surfaces built for
    verifying -- /explore and the workspace -- keep it open.
  */
  ledger?: "open" | "disclosure";
  /*
    BQ-063 / n34. /ko rendered this block's every word in English -- the field names of the
    ledger, the page caption, the footer. The locale picks a record in lib/proof-copy.ts and
    English is the default, so no English surface and no e2e selector moves.
  */
  korean?: boolean;
}) {
  const copy = proofCopy(korean);
  const active = regions.find(region => region.id === activeId) ?? regions[0];
  if (!active) return null;
  const onPage = regions.filter(region => sameSourcePage(active, region));
  const rendered = active.representationKind === "reference_render";
  const crop = sourceRegionRaster(active.digest, active.page, active.bbox1000);

  return <article className={styles.sheet} data-source-sheet="" data-ledger={ledger}>
    <header>
      <span className={styles.sheetName}><span>{active.filename}</span>
        {active.sourceLabel ? <small className={styles.sheetSource}>{active.sourceLabel}</small> : null}
      </span>
    </header>

    <div className={styles.sheetBody}>
      <div className={styles.sheetPage}>
        <OriginalSourcePage active={active} regions={onPage} onSelectRegion={onSelectRegion} korean={korean} />
      </div>

      <div className={styles.sheetAside}>
        {/*
          The region, cropped from the same render at twice the scale. Where no crop is committed
          the highlight drawn on the real page above carries the same information, so nothing is
          drawn here rather than a rectangle standing in for the evidence.
        */}
        {crop ? (
          <figure className={styles.regionCrop} data-region-crop={active.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the committed raster is
                served byte for byte: next/image would re-encode it, and the manifest's sha256 of
                these bytes is what makes the render checkable against its source. */}
            <img src={crop.file} alt={copy.cropAlt(active.page)} width={crop.width} height={crop.height} decoding="async" />
            <figcaption>{copy.cropCaption}</figcaption>
          </figure>
        ) : null}

        <div className={styles.passage} data-parsed-source-page="">
          <p className={styles.passageLabel}>{copy.passageLabel}</p>
          {onPage.map(region => {
            const isActive = region.id === active.id;
            const content = <>{isActive ? <span className={styles.regionPin} aria-hidden="true" /> : null}{region.excerpt}</>;
            return onSelectRegion ? <button key={region.id} type="button" className={styles.line} data-active={isActive ? "1" : "0"} data-region-id={region.id} {...(isActive ? { "data-active-region": "" } : {})} onClick={() => onSelectRegion(region.id)}>{content}</button>
              : <p key={region.id} className={styles.line} data-active={isActive ? "1" : "0"} data-region-id={region.id} {...(isActive ? { "data-active-region": "" } : {})}>{content}</p>;
          })}
        </div>
      </div>
    </div>

    <details className={styles.ledger} open={ledger === "open"} data-source-provenance="">
      <summary>{copy.verify}</summary>
      <dl className={styles.provenance}>
        <div><dt>{copy.fieldFiling}</dt><dd>{active.form ? `${active.form}${active.filingDate ? ` · ${copy.filed(active.filingDate)}` : ""}` : active.filename}</dd></div>
        <div><dt>{copy.fieldReadFrom}</dt><dd data-representation={active.representationKind ?? "original"}>{sourcePageQualifier(active.representationKind, korean)} · {active.filename}<span className={styles.digest}>{active.digest}</span></dd></div>
        {rendered && active.sourceFilename && active.originalSha256 ? <div><dt>{copy.fieldSource}</dt><dd data-acquired-original="">{copy.edgarPrimary} · {active.sourceFilename.replace(/^.*\//, "")}<span className={styles.digest}>{active.originalSha256}</span></dd></div> : null}
        <div><dt>{copy.fieldRegion}</dt><dd>{copy.bbox} · {active.bbox1000.join(", ")}</dd></div>
        {active.accession ? <div><dt>{copy.fieldAccession}</dt><dd>{active.accession}</dd></div> : null}
        <div><dt>{copy.fieldAuthority}</dt><dd>{active.authority}</dd></div>
      </dl>
    </details>

    <footer>
      <span>{active.compiledPageCount === undefined ? copy.asRead : active.compiledPageCount >= active.pageCount ? copy.fullyCompiled(active.pageCount) : copy.slice(active.compiledPageCount, active.pageCount)}</span>
      <span>
        <Link className={styles.sourceLink} href={active.href as Route} target="_blank" rel="noreferrer">{copy.openQualified(sourcePageQualifier(active.representationKind, korean))}</Link>
        {rendered && active.sourceHref ? <Link className={styles.sourceLink} href={active.sourceHref as Route} target="_blank" rel="noreferrer">{copy.openAcquired}</Link> : null}
        {active.secHref ? <a className={styles.sourceLink} href={active.secHref} target="_blank" rel="noreferrer">{copy.verifyOnSec}</a> : null}
      </span>
    </footer>
  </article>;
}
