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
  const active = regions.find((region) => region.id === activeId) ?? regions[0];
  if (!active) return null;
  const onPage = regions.filter((region) => region.page === active.page);

  // `data-source-sheet` names the source page, so a test or the visual-continuity capture can
  // address it rather than the first element on the stage that happens to say a filename.
  return (
    <article className={styles.sheet} data-source-sheet="" data-compact={compact ? "1" : "0"}>
      <header>
        <span className={styles.sheetName}>{active.filename}</span>
        <b>PAGE {active.page}</b>
      </header>
      <div className={styles.paper}>
        {onPage.map((region) => {
          const isActive = region.id === active.id;
          const content = (
            <>
              {isActive ? <span className={styles.regionPin} aria-hidden="true" /> : null}
              {region.excerpt}
            </>
          );
          return onSelectRegion ? (
            <button
              key={region.id}
              type="button"
              className={styles.line}
              data-active={isActive ? "1" : "0"}
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
              {...(isActive ? { "data-active-region": "" } : {})}
            >
              {content}
            </p>
          );
        })}
      </div>
      <PageRegion bbox1000={active.bbox1000} page={active.page} pageCount={active.pageCount} />
      {/*
        The version this page belongs to is named, not hashed.

        It used to read `SOURCE VERSION e8772bf183ab` here -- twelve characters of a sha256,
        which is a machine's way of saying "this file, this revision" and tells a reader
        nothing they can check. §49 takes the raw hash off the default surface; the whole
        digest is in the technical drawer, beside the file it belongs to.
      */}
      <footer>
        <span>THIS PAGE, AS THE COMPILER READ IT</span>
        <Link className={styles.sourceLink} href={active.href as Route} target="_blank" rel="noreferrer">
          Open source PDF ↗
        </Link>
      </footer>
    </article>
  );
}
