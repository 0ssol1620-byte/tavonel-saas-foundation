"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { ArrowLeft, Braces, FileText, Network, Quote, Search } from "lucide-react";
import Logomark from "@/components/logomark";
import styles from "@/app/explore/explore.module.css";
import type { ExploreSampleAnswer } from "@/lib/explore-sample";
import type { WorldObjectType, WorldReadModel } from "@/lib/world-read-model";

/*
  The sample stopped being written and started being compiled.

  Until this revision the page was four object literals and a `SOURCE` constant holding
  `sha256:3e118d4e...bf1c` and `bbox [118, 214, 886, 374]` for a file that did not exist. The
  product it described was real; every provenance value shown for it was made up, on the one
  page whose entire argument is that TAVONEL does not make things up.

  Everything here now comes from `lib/explore-sample.ts`, which runs the production compiler
  over three PDFs committed under `public/explore-sample/` and refuses to build if the result
  stops matching its frozen digest. The objects, the relations, the page numbers, the bounding
  boxes, the answers in the Ask panel and the scores beside them are all output. The visitor can
  open the source PDF and check.

  The chrome still says "Interactive sample" once, in the header badge, because a fixed corpus
  in the product's real interface would otherwise read as a live deployment. That label is the
  whole of the disclaimer; the page does not spend four paragraphs explaining itself.
*/

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

/*
  Claims first: it is the type a first-time reader can judge without learning the vocabulary.

  Every type the compiler emits is listed, including the ones it is weakest at. `Entity` on this
  corpus contains "The" and "Perform" alongside "FP-200", because the extractor takes
  capitalised runs and a sentence starts with a capital. Dropping the type from the filter would
  make the sample look better than the compiler is, and the counts in the bar above would stop
  adding up to the World.
*/
const TYPE_ORDER: WorldObjectType[] = ["Claim", "Document", "Entity", "Topic", "Evidence"];

function shortDigest(value: string) {
  const hex = value.replace(/^sha256:/, "");
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

export default function ExploreCompiledWorld({ world, documents, answers }: Props) {
  const [lens, setLens] = useState<Lens>("objects");
  const [type, setType] = useState<WorldObjectType>("Claim");
  /*
   * A phone opens on the source, not on the World.
   *
   * The World panel carries the readings that most resemble a live deployment; the source panel
   * carries the page, the region and the bbox that make them mean anything. Opening on the World
   * shows the first without the second on the screen with the least room to argue, which is the
   * defect this page was already fixed for once. Choosing evidence still switches here.
   */
  const [mobileView, setMobileView] = useState<"source" | "world">("source");
  const [activeObjectId, setActiveObjectId] = useState<string>(
    () => world.objects.find((object) => object.type === "Claim" && object.evidenceRefs.length > 0)?.id ?? world.objects[0].id,
  );
  const [activeEvidenceId, setActiveEvidenceId] = useState<string>(
    () => world.objects.find((object) => object.type === "Claim" && object.evidenceRefs.length > 0)?.evidenceRefs[0] ?? world.evidence[0].id,
  );
  const [question, setQuestion] = useState(0);

  const labelById = useMemo(
    () => new Map(world.objects.map((object) => [object.id, object] as const)),
    [world.objects],
  );
  const countsByType = useMemo(() => {
    const counts = new Map<WorldObjectType, number>();
    for (const object of world.objects) counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
    return counts;
  }, [world.objects]);

  const activeEvidence = world.evidence.find((item) => item.id === activeEvidenceId) ?? world.evidence[0];
  const activeObject = labelById.get(activeObjectId) ?? world.objects[0];
  const activeDocument = documents.find((item) => item.documentId === activeEvidence.sourceId) ?? documents[0];
  /* The page as compiled: one block per region, in the order the reader produced them. */
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

      <section className={styles.intro}>
        <Link href="/" className={styles.back}><ArrowLeft size={14} /> Home</Link>
        <p>EXPLORE · NO LOGIN REQUIRED</p>
        <h1>Follow a result all the way<br />back to its source.</h1>
        <div className={styles.introCopy}>
          <p>
            Three maintenance documents, compiled. Pick any object and TAVONEL shows the document
            version, the page and the exact region it came from — the same path an answer takes
            when it cites its evidence.
          </p>
        </div>
      </section>

      <section className={styles.instrument} aria-label="Compiled World sample">
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
            {/*
              The box is drawn from the region's own bbox, in thousandths of the page, so it is
              where the text is rather than where a stylesheet decided to put a rectangle.
            */}
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
            <span>VERSION {activeEvidence.sourceVersionId.slice(0, 12)}</span>
            <a className={styles.sourceLink} href={activeDocument.href} target="_blank" rel="noreferrer">OPEN SOURCE PDF</a>
            <span>BBOX [{activeEvidence.bbox.join(", ")}]</span>
          </footer>
        </article>

        <article className={styles.world} data-mobile-hidden={mobileView !== "world"}>
          <div className={styles.lenses} role="tablist" aria-label="World lenses">
            <button role="tab" aria-selected={lens === "objects"} onClick={() => setLens("objects")}><Network size={14} /> Objects</button>
            <button role="tab" aria-selected={lens === "relations"} onClick={() => setLens("relations")}><Braces size={14} /> Relations</button>
            <button role="tab" aria-selected={lens === "evidence"} onClick={() => setLens("evidence")}><Quote size={14} /> Evidence</button>
          </div>

          {lens === "objects" ? (
            <>
              <div className={styles.filters} role="group" aria-label="Object type">
                {TYPE_ORDER.filter((item) => countsByType.has(item)).map((item) => (
                  <button key={item} aria-pressed={type === item} onClick={() => setType(item)}>
                    {item} <b>{countsByType.get(item)}</b>
                  </button>
                ))}
              </div>
              <div className={styles.objectList}>
                {world.objects.filter((object) => object.type === type).map((object) => (
                  <button key={object.id} onClick={() => selectObject(object.id)} aria-pressed={activeObjectId === object.id}>
                    <small>{object.type.toUpperCase()}</small>
                    <span>{object.label}</span>
                    <b data-tone="qualified">{object.evidenceRefs.length} EVIDENCE</b>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {lens === "relations" ? (
            <div className={styles.objectList}>
              {world.relations.map((relation) => (
                <button key={relation.id} onClick={() => selectObject(relation.subject)} aria-pressed={activeObjectId === relation.subject}>
                  <small>{relation.predicate.replaceAll("_", " ").toUpperCase()}</small>
                  <span>{labelById.get(relation.subject)?.label ?? relation.subject} → {labelById.get(relation.object)?.label ?? relation.object}</span>
                  <b data-tone="qualified">{relation.evidenceRefs.length} EVIDENCE</b>
                </button>
              ))}
            </div>
          ) : null}

          {lens === "evidence" ? (
            <div className={styles.objectList}>
              {world.evidence.map((item) => (
                <button key={item.id} onClick={() => selectEvidence(item.id)} aria-pressed={activeEvidence.id === item.id}>
                  <small>P{item.page} · {item.authority.toUpperCase()}</small>
                  <span>{item.excerpt}</span>
                  <b data-tone="qualified">BBOX</b>
                </button>
              ))}
            </div>
          ) : null}

          <section className={styles.inspector}>
            <p>SEMANTIC OBJECT INSPECTOR</p>
            <h2>{activeObject.label}</h2>
            <dl>
              <div><dt>Type</dt><dd>{activeObject.type}</dd></div>
              <div><dt>Stable key</dt><dd>{activeObject.stableKey}</dd></div>
              <div><dt>Status</dt><dd>{activeObject.status}</dd></div>
              <div><dt>Source version</dt><dd>{activeEvidence.sourceVersionId.slice(0, 24)}…</dd></div>
              <div><dt>Location</dt><dd>p.{activeEvidence.page} · [{activeEvidence.bbox.join(", ")}]</dd></div>
              <div><dt>Source digest</dt><dd>{activeEvidence.digest}</dd></div>
              <div><dt>Relations</dt><dd>{activeObject.relations.length}</dd></div>
            </dl>
          </section>
        </article>

        <aside className={styles.answer}>
          <div><Search size={15} /><span>Ask this World</span></div>
          <div className={styles.questions} role="group" aria-label="Sample questions">
            {answers.map((item, index) => (
              <button key={item.question} aria-pressed={question === index} onClick={() => setQuestion(index)}>
                {item.question}
              </button>
            ))}
          </div>
          <p>{citation.excerpt}</p>
          <button onClick={() => { if (citedEvidence) selectEvidence(citedEvidence.id); }}>
            <Quote size={13} /> Open citation · p.{citation.pageNumber1}
          </button>
          <small>
            {/*
              The score is the retriever's, printed rather than described. A demo that says
              "highly relevant" is making a claim; a demo that says 0.82 is showing one.
            */}
            {citation.sourceId} · relevance {citation.relevance.toFixed(2)} · {answer.citations.length} regions cited
          </small>
        </aside>
      </section>

      <section className={styles.next}>
        <p>INPUT → COMPILED WORLD → GROUNDED USE</p>
        <h2>Bring your own sources when you are ready.</h2>
        <div>
          <Link href={"/contact" as Route}>Request access</Link>
          <Link href="/product/compiled-world">How Compiled Worlds work</Link>
        </div>
      </section>
    </main>
  );
}
