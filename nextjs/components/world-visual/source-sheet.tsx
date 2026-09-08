"use client";

/*
  The source page, as a page.

  Every paragraph here is a compiled region's own text, in the order the extractor read it, and
  the marked one is the region the selected object was compiled from. Nothing is rendered that
  is not in the artifact -- there is no filler body text making the sheet look like a document,
  because a sheet with invented paragraphs would be a picture of provenance rather than
  provenance.

  The PDF stays a link. Rendering it would cost a viewer bundle on a page whose whole budget
  argument is that it ships no film and no reader (§58); the link opens the same bytes whose
  sha256 the technical drawer prints.
*/

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import PageRegion from "./page-region";
import styles from "./world-visual.module.css";
import type { VisualEvidence } from "@/lib/visual-world-model";

export default function SourceSheet({
  regions,
  activeId,
  onSelectRegion,
  compact = false,
}: {
  regions: VisualEvidence[];
  activeId: string;
  onSelectRegion?: (id: string) => void;
  compact?: boolean;
}) {
  /*
    The page scrolls inside the sheet, so the marked region has to be brought to it.

    Written against the container's own `scrollTop` rather than `scrollIntoView`, which walks
    every scrollable ancestor: on first paint the sheet is usually below the fold, and letting
    the browser satisfy it by scrolling the window would jump a reader who has not asked to move.
    This moves one element's scroll offset and nothing else.
  */
  const paperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const paper = paperRef.current;
    const region = paper?.querySelector<HTMLElement>("[data-active-region]");
    if (!paper || !region) return;
    paper.scrollTop = Math.max(0, region.offsetTop - (paper.clientHeight - region.clientHeight) / 2);
  }, [activeId]);

  const active = regions.find((region) => region.id === activeId) ?? regions[0];
  if (!active) return null;
  const onPage = regions.filter((region) => region.page === active.page);
  const rendered = active.representationKind === "reference_render";

  // `data-source-sheet` names the source page, so a test or the visual-continuity capture can
  // address it rather than the first element on the stage that happens to say a filename.
  return (
    <article className={styles.sheet} data-source-sheet="" data-compact={compact ? "1" : "0"}>
      <header>
        <span className={styles.sheetName}>
          <span>{active.filename}</span>
          {active.sourceLabel ? <small className={styles.sheetSource}>{active.sourceLabel}</small> : null}
        </span>
        <b>PAGE {active.page}</b>
      </header>
      <div className={styles.paper} ref={paperRef}>
        {onPage.map((region) => {
          const isActive = region.id === active.id;
          const content = (
            <>
              {isActive ? <span className={styles.regionPin} aria-hidden="true" /> : null}
              {region.excerpt}
            </>
          );
          /*
            The region's own id, published on the line that carries it.

            `?evidence=<regionId>` links a claim to the exact region it was compiled from, and
            the id has to be readable from the page for that link to be constructible or
            checkable at all. It is the compiler's id, which is machine detail -- but it is a DOM
            attribute rather than something the reader is shown, and the excerpt beside it is
            already the region's own text.
          */
          return onSelectRegion ? (
            <button
              key={region.id}
              type="button"
              className={styles.line}
              data-active={isActive ? "1" : "0"}
              data-region-id={region.id}
              {...(isActive ? { "data-active-region": "" } : {})}
              onClick={() => onSelectRegion(region.id)}
            >
              {content}
            </button>
          ) : (
            <p
              key={region.id}
              className={styles.line}
              data-active={isActive ? "1" : "0"}
              data-region-id={region.id}
              {...(isActive ? { "data-active-region": "" } : {})}
            >
              {content}
            </p>
          );
        })}
      </div>
      <PageRegion bbox1000={active.bbox1000} page={active.page} pageCount={active.pageCount} />

      {/*
        Which bytes this region was read out of, and which bytes are the source (§11.3, §11.6).

        This is the one place on the default surface where digests belong, because it is the one
        place the distinction can be misread: for a 2026 filing the page above is a *reference
        render* of an SEC EDGAR HTML primary document, and a reader shown a rendered page and a
        single hash would reasonably conclude they were looking at the original. Both digests are
        printed, labelled, side by side. Everything else about the compile stays in the technical
        drawer, which is what §7.4 asks for and what the earlier "SOURCE VERSION e8772bf183ab"
        line -- twelve characters of a hash, attached to nothing a reader could check -- was
        removed for.
      */}
      <dl className={styles.provenance} data-source-provenance="">
        <div>
          <dt>Filing</dt>
          <dd>
            {active.form
              ? `${active.form}${active.filingDate ? ` · filed ${active.filingDate}` : ""}`
              : active.filename}
          </dd>
        </div>
        <div>
          <dt>Read from</dt>
          <dd data-representation={active.representationKind ?? "original"}>
            {rendered ? "Reference render" : "Original"} · {active.filename}
            <br />
            <span className={styles.digest}>{active.digest}</span>
          </dd>
        </div>
        {rendered && active.sourceFilename && active.originalSha256 ? (
          <div>
            <dt>Source</dt>
            <dd data-acquired-original="">
              SEC EDGAR primary document · {active.sourceFilename.replace(/^.*\//, "")}
              <br />
              <span className={styles.digest}>{active.originalSha256}</span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Region</dt>
          <dd>
            Page {active.page} of {active.pageCount} · bbox (per mille) {active.bbox1000.join(", ")}
          </dd>
        </div>
        {active.accession ? (
          <div>
            <dt>Accession</dt>
            <dd>{active.accession}</dd>
          </div>
        ) : null}
        <div>
          <dt>Authority</dt>
          <dd>{active.authority}</dd>
        </div>
      </dl>

      <footer>
        <span>
          {/*
            §57: whichever of the two this filing is, in its own words.

            "Curated slice" was the truth about every filing when three pages of each were
            compiled. It is now the truth about one of them, and printing it over a filing
            compiled end to end would understate the World as badly as the reverse would
            overstate it. Both branches read the same measured field.
          */}
          {active.compiledPageCount === undefined
            ? "THIS PAGE, AS THE COMPILER READ IT"
            : active.compiledPageCount >= active.pageCount
              ? `FULL FILING COMPILED · ${active.pageCount} PAGES`
              : `CURATED PAGE SLICE · ${active.compiledPageCount} OF ${active.pageCount} PAGES COMPILED`}
        </span>
        <Link className={styles.sourceLink} href={active.href as Route} target="_blank" rel="noreferrer">
          {rendered ? "Open reference render ↗" : "Open committed PDF ↗"}
        </Link>
        {rendered && active.sourceHref ? (
          <Link className={styles.sourceLink} href={active.sourceHref as Route} target="_blank" rel="noreferrer">
            Open acquired original ↗
          </Link>
        ) : null}
        {active.secHref ? (
          <a className={styles.sourceLink} href={active.secHref} target="_blank" rel="noreferrer">
            Verify on SEC ↗
          </a>
        ) : null}
      </footer>
    </article>
  );
}
