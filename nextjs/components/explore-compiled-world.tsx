"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { ArrowLeft, Braces, FileText, Network, Quote, Search } from "lucide-react";
import Logomark from "@/components/logomark";
import styles from "@/app/explore/explore.module.css";
import polish from "@/app/explore/explore-polish.module.css";
import type { ExploreSampleAnswer } from "@/lib/explore-sample";
import type { WorldObjectType, WorldReadModel } from "@/lib/world-read-model";

type Props = {
  world: WorldReadModel;
  documents: ReadonlyArray<{
    documentId: string;
    filename: string;
    href: string;
    digest: string;
    pageCount: number;
    regionCount: number;
  }>;
  answers: ReadonlyArray<ExploreSampleAnswer>;
};

type Lens = "objects" | "relations" | "evidence";
const TYPE_ORDER: WorldObjectType[] = ["Claim", "Document", "Entity", "Topic", "Evidence"];

function shortDigest(value: string) {
  const hex = value.replace(/^sha256:/, "");
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

export default function ExploreCompiledWorld({ world, documents, answers }: Props) {
  const [lens, setLens] = useState<Lens>("objects");
  const [type, setType] = useState<WorldObjectType>("Claim");
  const [mobileView, setMobileView] = useState<"source" | "world">("source");
  const [activeObjectId, setActiveObjectId] = useState<string>(
    () => world.objects.find((object) => object.type === "Claim" && object.evidenceRefs.length > 0)?.id ?? world.objects[0].id,
  );
  const [activeEvidenceId, setActiveEvidenceId] = useState<string>(
    () => world.objects.find((object) => object.type === "Claim" && object.evidenceRefs.length > 0)?.evidenceRefs[0] ?? world.evidence[0].id,
  );
  const [question, setQuestion] = useState(0);

  const labelById = useMemo(() => new Map(world.objects.map((object) => [object.id, object] as const)), [world.objects]);
  const countsByType = useMemo(() => {
    const counts = new Map<WorldObjectType, number>();
    for (const object of world.objects) counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
    return counts;
  }, [world.objects]);

  const activeEvidence = world.evidence.find((item) => item.id === activeEvidenceId) ?? world.evidence[0];
  const activeObject = labelById.get(activeObjectId) ?? world.objects[0];
  const activeDocument = documents.find((item) => item.documentId === activeEvidence.sourceId) ?? documents[0];
  const page = world.evidence.filter((item) => item.sourceId === activeDocument.documentId);

  const selectObject = (id: string) => {
    setActiveObjectId(id);
    const first = labelById.get(id)?.evidenceRefs[0];
    if (first) setActiveEvidenceId(first);
  };

  const selectEvidence = (id: string) => {
    setActiveEvidenceId(id);
    const owner = world.objects.find((object) => object.evidenceRefs.includes(id));
    if (owner) setActiveObjectId(owner.id);
    setMobileView("source");
  };

  const answer = answers[question];
  const citation = answer.citations[0];
  const citedEvidence = world.evidence.find(
    (item) => item.sourceId === citation.sourceId && item.bbox.join(",") === citation.bbox1000.join(","),
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><Logomark size={22} /><b>TAVONEL</b></Link>
        <span>INTERACTIVE SAMPLE</span>
        <nav><Link href="/evidence">How evidence works</Link><Link href="/login">Sign in</Link></nav>
      </header>

      <section className={`${styles.intro} ${polish.intro}`}>
        <Link href="/" className={styles.back}><ArrowLeft size={14} /> Home</Link>
        <p>EXPLORE · NO LOGIN REQUIRED</p>
        <h1>Follow a result back to its source.</h1>
        <div className={`${styles.introCopy} ${polish.introCopy}`}>
          <p>Pick any compiled object. TAVONEL opens the document version, page and exact source region behind it — the same evidence path Ask uses.</p>
        </div>
      </section>

      <section className={`${styles.instrument} ${polish.instrument}`} aria-label="Compiled World sample">
        <div className={styles.instrumentBar}>
          <div><small>WORLD</small><strong>{world.world.id.replace("collection-", "").slice(0, 12)} · {world.world.status.toUpperCase()}</strong></div>
          <div><small>DIGEST</small><strong>{shortDigest(world.world.manifestDigest)}</strong></div>
          <div><small>OBJECTS</small><strong>{world.objects.length} · {world.evidence.length} REGIONS</strong></div>
          <div><small>SOURCE</small><strong>{documents.length} DOCUMENTS</strong></div>
        </div>

        <div className={styles.mobileSwitch} role="group" aria-label="Sample view">
          <button aria-pressed={mobileView === "source"} onClick={() => setMobileView("source")}>Source</button>
          <button aria-pressed={mobileView === "world"} onClick={() => setMobileView("world")}>World</button>
        </div>

        <article className={styles.source} data-mobile-hidden={mobileView !== "source"}>
          <header>
            <FileText size={15} />
            <span>{activeDocument.filename}</span>
            <b>PAGE {activeEvidence.page}</b>
          </header>
          <div className={styles.paper}>
            {page.map((region) => (
              region.id === activeEvidence.id
                ? <mark key={region.id}>{region.excerpt}</mark>
                : <p key={region.id}>{region.excerpt}</p>
            ))}
          </div>
          <div className={styles.pageMap}>
            <div
              className={styles.pageBox}
              style={{
                left: `${activeEvidence.bbox[0] / 10}%`,
                top: `${activeEvidence.bbox[1] / 10}%`,
                width: `${(activeEvidence.bbox[2] - activeEvidence.bbox[0]) / 10}%`,
                height: `${(activeEvidence.bbox[3] - activeEvidence.bbox[1]) / 10}%`,
              }}
            />
            <small>REGION ON PAGE {activeEvidence.page} OF {activeDocument.pageCount}</small>
          </div>
          <footer>
            <span>{shortDigest(activeDocument.digest)}</span>
            <Link className={styles.sourceLink} href={activeDocument.href as Route} target="_blank">Open source PDF ↗</Link>
          </footer>
        </article>

        <article className={styles.world} data-mobile-hidden={mobileView !== "world"}>
          <div className={styles.lenses} role="tablist" aria-label="World lens">
            <button role="tab" aria-selected={lens === "objects"} onClick={() => setLens("objects")}><Network size={13} /> Objects</button>
            <button role="tab" aria-selected={lens === "relations"} onClick={() => setLens("relations")}><Braces size={13} /> Relations</button>
            <button role="tab" aria-selected={lens === "evidence"} onClick={() => setLens("evidence")}><Quote size={13} /> Evidence</button>
          </div>

          {lens === "objects" ? (
            <>
              <div className={styles.filters}>
                {TYPE_ORDER.map((item) => (
                  <button key={item} aria-pressed={type === item} onClick={() => setType(item)}>{item} <b>{countsByType.get(item) ?? 0}</b></button>
                ))}
              </div>
              <div className={styles.objectList}>
                {world.objects.filter((object) => object.type === type).map((object) => (
                  <button key={object.id} aria-pressed={object.id === activeObject.id} onClick={() => selectObject(object.id)}>
                    <small>{object.type}</small><span>{object.label}</span><b data-tone={object.evidenceRefs.length ? "qualified" : "research"}>{object.evidenceRefs.length} EVIDENCE</b>
                  </button>
                ))}
              </div>
              <div className={styles.inspector}>
                <p>SELECTED {activeObject.type.toUpperCase()}</p>
                <h2>{activeObject.label}</h2>
                <dl>
                  <div><dt>Object ID</dt><dd>{activeObject.id}</dd></div>
                  <div><dt>Evidence</dt><dd>{activeObject.evidenceRefs.length}</dd></div>
                  <div><dt>Relations</dt><dd>{activeObject.relations.length}</dd></div>
                </dl>
              </div>
            </>
          ) : lens === "relations" ? (
            <div className={styles.objectList}>
              {world.relations.map((relation) => (
                <button key={relation.id} onClick={() => relation.evidenceRefs[0] && selectEvidence(relation.evidenceRefs[0])}>
                  <small>RELATION</small><span>{labelById.get(relation.subject)?.label} → {relation.predicate} → {labelById.get(relation.object)?.label}</span><b data-tone="qualified">{relation.evidenceRefs.length} EVIDENCE</b>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.objectList}>
              {world.evidence.map((evidence) => (
                <button key={evidence.id} aria-pressed={evidence.id === activeEvidence.id} onClick={() => selectEvidence(evidence.id)}>
                  <small>PAGE {evidence.page}</small><span>{evidence.excerpt}</span><b data-tone="qualified">BBOX</b>
                </button>
              ))}
            </div>
          )}
        </article>

        <section className={styles.answer} aria-label="Grounded answer sample">
          <div><Search size={14} /><span>ASK THIS WORLD</span></div>
          <div className={styles.questions}>
            {answers.map((item, index) => <button key={item.question} aria-pressed={question === index} onClick={() => setQuestion(index)}>{item.question}</button>)}
          </div>
          <button type="button" onClick={() => citedEvidence && selectEvidence(citedEvidence.id)}>Open cited evidence</button>
          <p><strong>{answer.status === "grounded" ? answer.answer : "TAVONEL abstained."}</strong>{answer.reason ? ` ${answer.reason}` : ""}</p>
          <small>{answer.status.toUpperCase()} · WORLD {shortDigest(answer.receipt.manifestDigest)} · {answer.citations.length} CITATION{answer.citations.length === 1 ? "" : "S"}</small>
        </section>
      </section>

      <section className={styles.next}>
        <p>YOUR SOURCES</p>
        <h2>Try the same path with your own documents.</h2>
        <div><Link href="/login">Start free</Link><Link href="/product/knowledge-compiler">How compilation works</Link></div>
      </section>
    </main>
  );
}
