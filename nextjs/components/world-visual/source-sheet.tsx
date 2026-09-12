"use client";

/* The original PDF and extracted text are different views of the same source identity.
   OriginalSourcePage renders hash-checked bytes. Parsed text is never passed off as a page image. */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import PageRegion from "./page-region";
import OriginalSourcePage from "./original-source-page";
import styles from "./world-visual.module.css";
import sourceStyles from "./original-source-page.module.css";
import type { VisualEvidence } from "@/lib/visual-world-model";
import { sameSourcePage } from "@/lib/source-page-geometry";

export default function SourceSheet({ regions, activeId, onSelectRegion, compact = false }: {
  regions: VisualEvidence[]; activeId: string; onSelectRegion?: (id: string) => void; compact?: boolean;
}) {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"original" | "text">("original");
  const uid = useId();
  useEffect(() => {
    const paper = paperRef.current;
    const region = paper?.querySelector<HTMLElement>("[data-active-region]");
    if (!paper || !region || view !== "text") return;
    paper.scrollTop = Math.max(0, region.offsetTop - (paper.clientHeight - region.clientHeight) / 2);
  }, [activeId, view]);
  const active = regions.find(region => region.id === activeId) ?? regions[0];
  if (!active) return null;
  const onPage = regions.filter(region => sameSourcePage(active, region));
  const rendered = active.representationKind === "reference_render";
  return <article className={styles.sheet} data-source-sheet="" data-compact={compact ? "1" : "0"} data-source-view={view}>
    <header>
      <span className={styles.sheetName}><span>{active.filename}</span>
        {active.sourceLabel ? <small className={styles.sheetSource}>{active.sourceLabel}</small> : null}
      </span><b>PAGE {active.page}</b>
    </header>
    <div role="tablist" aria-label="Source representation" className={sourceStyles.tabs} onKeyDown={event => {
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      let target = index;
      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = tabs.length - 1;
      else return;
      event.preventDefault(); tabs[target]?.focus();
    }}>
      <button id={`${uid}-original-tab`} type="button" role="tab" aria-selected={view === "original"} aria-controls={`${uid}-original-panel`} tabIndex={view === "original" ? 0 : -1} onClick={() => setView("original")}>{rendered ? "Reference page" : "Original page"}</button>
      <button id={`${uid}-text-tab`} type="button" role="tab" aria-selected={view === "text"} aria-controls={`${uid}-text-panel`} tabIndex={view === "text" ? 0 : -1} onClick={() => setView("text")}>Parsed text</button>
    </div>
    <div id={`${uid}-original-panel`} role="tabpanel" aria-labelledby={`${uid}-original-tab`} hidden={view !== "original"} style={{ display: view === "original" ? undefined : "none" }}>
      <OriginalSourcePage active={active} regions={onPage} onSelectRegion={onSelectRegion} compact={compact} />
    </div>
    <div id={`${uid}-text-panel`} role="tabpanel" aria-labelledby={`${uid}-text-tab`} hidden={view !== "text"} style={{ display: view === "text" ? undefined : "none" }}>
      <div className={styles.paper} ref={paperRef} data-parsed-source-page="">
        {onPage.map(region => {
          const isActive = region.id === active.id;
          const content = <>{isActive ? <span className={styles.regionPin} aria-hidden="true" /> : null}{region.excerpt}</>;
          return onSelectRegion ? <button key={region.id} type="button" className={styles.line} data-active={isActive ? "1" : "0"} data-region-id={region.id} {...(isActive ? { "data-active-region": "" } : {})} onClick={() => onSelectRegion(region.id)}>{content}</button>
            : <p key={region.id} className={styles.line} data-active={isActive ? "1" : "0"} data-region-id={region.id} {...(isActive ? { "data-active-region": "" } : {})}>{content}</p>;
        })}
      </div>
      <PageRegion bbox1000={active.bbox1000} page={active.page} pageCount={active.pageCount} />
    </div>
    <dl className={styles.provenance} data-source-provenance="">
      <div><dt>Filing</dt><dd>{active.form ? `${active.form}${active.filingDate ? ` · filed ${active.filingDate}` : ""}` : active.filename}</dd></div>
      <div><dt>Read from</dt><dd data-representation={active.representationKind ?? "original"}>{rendered ? "Reference render" : "Original"} · {active.filename}<br /><span className={styles.digest}>{active.digest}</span></dd></div>
      {rendered && active.sourceFilename && active.originalSha256 ? <div><dt>Source</dt><dd data-acquired-original="">SEC EDGAR primary document · {active.sourceFilename.replace(/^.*\//, "")}<br /><span className={styles.digest}>{active.originalSha256}</span></dd></div> : null}
      <div><dt>Region</dt><dd>Page {active.page} of {active.pageCount} · bbox (per mille) {active.bbox1000.join(", ")}</dd></div>
      {active.accession ? <div><dt>Accession</dt><dd>{active.accession}</dd></div> : null}
      <div><dt>Authority</dt><dd>{active.authority}</dd></div>
    </dl>
    <footer>
      <span>{active.compiledPageCount === undefined ? "THIS PAGE, AS THE COMPILER READ IT" : active.compiledPageCount >= active.pageCount ? `FULL FILING COMPILED · ${active.pageCount} PAGES` : `CURATED PAGE SLICE · ${active.compiledPageCount} OF ${active.pageCount} PAGES COMPILED`}</span>
      <Link className={styles.sourceLink} href={active.href as Route} target="_blank" rel="noreferrer">{rendered ? "Open reference render ↗" : "Open committed PDF ↗"}</Link>
      {rendered && active.sourceHref ? <Link className={styles.sourceLink} href={active.sourceHref as Route} target="_blank" rel="noreferrer">Open acquired original ↗</Link> : null}
      {active.secHref ? <a className={styles.sourceLink} href={active.secHref} target="_blank" rel="noreferrer">Verify on SEC ↗</a> : null}
    </footer>
  </article>;
}
