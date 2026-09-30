"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import OriginalSourcePage from "@/components/world-visual/original-source-page";
import { sourcePageQualifier } from "@/lib/source-page-rasters";
import type { ExploreAnswerView, ExploreTechnicalRecord } from "@/lib/explore-story";
import type { VisualWorldModel } from "@/lib/visual-world-model";
import styles from "./evidence-workbench.module.css";

/** A bounded artifact browser: filtering sample questions never pretends to run a live AI. */
export default function EvidenceWorkbench({ model, answers, technical, capturedOn, onOpenRegion, onRelations, onChanges }: {
  model: VisualWorldModel; answers: ExploreAnswerView[]; technical: ExploreTechnicalRecord;
  capturedOn: string; onOpenRegion: (id: string) => void; onRelations: () => void; onChanges: () => void;
}) {
  const [question, setQuestion] = useState(0);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"content" | "documents">("content");
  const [mobilePane, setMobilePane] = useState<"result" | "source">("result");
  const [regionId, setRegionId] = useState<string | null>(null);
  useEffect(() => {
    const restore = () => {
      const raw = new URLSearchParams(window.location.search).get("question");
      const value = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
      setQuestion(value < answers.length ? value : 0);
      setRegionId(null);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [answers.length]);
  const answer = answers[question];
  const regions = useMemo(() => model.evidence.filter(region => answer?.regions.some(citation => citation.evidenceId === region.id)), [model.evidence, answer]);
  const active = regions.find(region => region.id === regionId) ?? regions[0];
  const filtered = answers.map((item, index) => ({ item, index })).filter(({item}) => item.question.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function selectQuestion(index: number) {
    setQuestion(index); setRegionId(null); setMobilePane("result");
    const url = new URL(window.location.href);
    url.searchParams.set("question", String(index));
    window.history.pushState(null, "", url);
  }
  return <div className={styles.workbench} data-evidence-workbench="">
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>Explore / public knowledge sample</p><h1>A result is only the beginning.<br /><span>Follow it to the source.</span></h1></div>
      <p className={styles.scope}>Read-only sample · sources captured {capturedOn}<br />{technical.documents.length} public filings · Apple SEC documents<br /><Link href="/reproducibility">View the sample manifest ↗</Link></p>
    </div>
    <div className={styles.tabs} aria-label="Explore views">
      <button type="button" aria-pressed={tab === "content"} onClick={() => setTab("content")}>Content & evidence</button>
      <button type="button" aria-pressed={tab === "documents"} onClick={() => setTab("documents")}>Documents</button>
      <button type="button" onClick={onRelations}>Relations ↗</button>
      <button type="button" onClick={onChanges}>Changes ↗</button>
    </div>
    {tab === "documents" ? <section className={styles.documents} aria-label="Sample documents">
      <h2>The exact sources behind this sample</h2>
      <p>Page coverage describes where the compiler produced a region, not a completeness or accuracy score.</p>
      {technical.documents.map(document => <article key={document.documentId}>
        <div><strong>{document.filename}</strong><p>{document.form} · filed {document.filingDate}</p></div>
        <span>{document.compiledPageCount ?? "Unknown"} / {document.pageCount} pages with evidence regions</span>
      </article>)}
    </section> : <>
      <div className={styles.questionArea}>
        <label htmlFor="sample-question-filter">Find a sample question</label>
        <input id="sample-question-filter" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter the prepared questions…" aria-describedby="sample-question-scope" />
        <p id="sample-question-scope">Prepared retrieval results from this artifact. Free-form AI queries are not running in this public demo.</p>
        <div className={styles.questions} role="group" aria-label="Sample questions">
          {filtered.map(({item,index}) => <button key={item.question} type="button" aria-pressed={question === index} onClick={() => selectQuestion(index)}>{item.question}</button>)}
          {filtered.length === 0 ? <p role="status">No sample question matches. <button type="button" onClick={() => setQuery("")}>Show all questions</button></p> : null}
        </div>
      </div>
      <div className={styles.mobileTabs} aria-label="Reading pane">
        <button type="button" aria-pressed={mobilePane === "result"} onClick={() => setMobilePane("result")}>Result</button>
        <button type="button" aria-pressed={mobilePane === "source"} onClick={() => setMobilePane("source")}>Source</button>
      </div>
      <div className={styles.reading} data-mobile-pane={mobilePane}>
        <article className={styles.result} aria-label="Selected sample answer">
          <header><span>Retrieved source passage</span><span className={styles.candidate}>Candidate · inspect evidence</span></header>
          {answer ? <><h2>{answer.question}</h2><blockquote>{answer.answer}</blockquote>
            <p className={styles.answerNote}>This is a quotation selected by retrieval, not an independently verified conclusion.</p>
            <div className={styles.citations} aria-label="Source evidence">{regions.map(region => <button type="button" key={region.id} aria-pressed={active?.id === region.id} onClick={() => {setRegionId(region.id); setMobilePane("source");}}><span>{region.filename}</span><strong>Page {region.page} →</strong></button>)}</div>
          </> : <p>No prepared answer is available in this artifact.</p>}
          {active ? <div className={styles.version}><span>Source version</span><code title={active.sourceVersionId}>{active.sourceVersionId}</code><button type="button" onClick={() => onOpenRegion(active.id)}>Open full evidence inspector ↗</button><Link href={`/explore?act=evidence&evidence=${encodeURIComponent(active.id)}` as Route}>Permanent evidence link ↗</Link></div> : <p role="status">No source region is available. Choose another sample question.</p>}
        </article>
        <aside className={styles.source} aria-label="Original source viewer">
          <header><span>{active ? sourcePageQualifier(active.representationKind) : "Source"}</span><span>{active ? `Page ${active.page}` : "Unavailable"}</span></header>
          {active ? <><OriginalSourcePage active={active} regions={regions} onSelectRegion={setRegionId} /><div className={styles.sourceExcerpt}><p>Exact selected passage</p><blockquote>{active.excerpt}</blockquote></div></> : <p>The sample has no source page for this answer.</p>}
        </aside>
      </div>
    </>}
    <p className={styles.boundary}>This sample is compiled from Apple’s public SEC filings at a single permission level. One issuer’s clean English-language filings are not a claim about a mixed internal corpus, degraded scans, tables, or your access policies. <Link href="/sources">Supported scope</Link> · <Link href="/evaluation">Evaluate your documents</Link></p>
  </div>;
}
