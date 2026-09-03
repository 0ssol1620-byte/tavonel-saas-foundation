"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { ArrowLeft, Braces, FileText, Network, Quote, Search } from "lucide-react";
import Logomark from "@/components/logomark";
import styles from "@/app/explore/explore.module.css";

/*
  The sample changed subject, and lost its asterisks.

  Two problems with the old one. It compiled TAVONEL's own retention policy, so the page taught
  a first-time visitor that "source material is retained for 30 days" — presented in product
  chrome, indistinguishable from our actual privacy commitment, which is not what that page
  says. And the third object was a RESEARCH FRONTIER card whose every field read `not_yet`: the
  one interactive demonstration on the site, showing a reader a feature that does not work.

  This is a maintenance manual instead. It is neutral, it is the kind of document the product is
  actually for, and every object in it resolves to a real region of the page. The chrome says
  "Interactive sample" once, quietly, and then gets out of the way — a sample does not need four
  paragraphs explaining that it is a sample.
*/

const OBJECTS = [
  { id: "asset-fp200", type: "ASSET", label: "Feedwater pump FP-200", detail: "Equipment identified across the manual, the change notice and the service log as one asset." },
  { id: "claim-interval", type: "CLAIM", label: "Service interval is 2,000 operating hours", detail: "The interval as stated in revision C of the maintenance manual." },
  { id: "claim-depressurise", type: "CLAIM", label: "Seal replacement requires depressurisation", detail: "A safety precondition attached to the seal replacement procedure." },
  { id: "relation-supersedes", type: "RELATION", label: "Revision C supersedes revision B", detail: "The 1,500-hour interval in revision B is superseded and no longer answers this question." },
] as const;

const SOURCE = {
  name: "FP-200-maintenance-manual-revC.pdf",
  digest: "sha256:3e118d4e...bf1c",
  version: "src_v_03",
  page: 12,
  bbox: "[118, 214, 886, 374]",
};

export default function ExploreCompiledWorld() {
  const [selected, setSelected] = useState(1);
  const [mobileView, setMobileView] = useState<"source" | "world">("source");
  const object = OBJECTS[selected] ?? OBJECTS[0];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><Logomark size={22} /><b>TAVONEL</b></Link>
        <span>INTERACTIVE SAMPLE</span>
        <nav><Link href="/evidence">How evidence works</Link><Link href="/login">Sign in</Link></nav>
      </header>

      <section className={styles.intro}>
        <Link href="/" className={styles.back}><ArrowLeft size={14} /> Home</Link>
        {/*
          The sample says it is one exactly once, in the header badge above.

          It is worth naming what was removed. This page used to carry "DETERMINISTIC PRODUCT
          SAMPLE", "not customer proof", and a research card whose every field read `not_yet` --
          three separate answers to an accusation nobody browsing a demo has made, which
          together made the strongest page on the site look like the weakest. The label stays
          because a fixed fixture in the product's real interface would otherwise read as a
          live deployment; the arguing goes.
        */}
        <p>EXPLORE · NO LOGIN REQUIRED</p>
        <h1>Follow a result all the way<br />back to its source.</h1>
        <div className={styles.introCopy}>
          <p>
            A maintenance manual, compiled. Pick any object and TAVONEL shows the document version,
            the page and the exact region it came from — the same path an answer takes when it
            cites its evidence.
          </p>
        </div>
      </section>

      <section className={styles.instrument} aria-label="Compiled World sample">
        <div className={styles.instrumentBar}>
          <div><small>WORLD</small><strong>fp-200-maintenance · v3 ACTIVE</strong></div>
          <div><small>OBJECTS</small><strong>4 WITH EVIDENCE</strong></div>
          <div><small>PROVENANCE</small><strong>PAGE + BBOX BOUND</strong></div>
          <div><small>SOURCE</small><strong>REVISION C</strong></div>
        </div>

        <div className={styles.mobileSwitch} role="group" aria-label="Sample view">
          <button aria-pressed={mobileView === "source"} onClick={() => setMobileView("source")}>Source</button>
          <button aria-pressed={mobileView === "world"} onClick={() => setMobileView("world")}>World</button>
        </div>

        <article className={styles.source} data-mobile-hidden={mobileView !== "source"}>
          <header><FileText size={15} /><span>{SOURCE.name}</span><b>PAGE {SOURCE.page}</b></header>
          <div className={styles.paper}>
            <p>12. Scheduled maintenance — feedwater pump FP-200</p>
            <p>The unit is rated for continuous duty. Inspection points are listed in table 12.1.</p>
            <mark data-selected={selected === 1}>Perform the full service procedure every 2,000 operating hours. This interval replaces the 1,500-hour interval published in revision B.</mark>
            <p>Before replacing the mechanical seal, isolate and fully depressurise the unit.</p>
            <i aria-hidden="true" />
          </div>
          <footer><span>VERSION {SOURCE.version}</span><span>BBOX {SOURCE.bbox}</span></footer>
        </article>

        <article className={styles.world} data-mobile-hidden={mobileView !== "world"}>
          <div className={styles.lenses} role="tablist" aria-label="World lenses">
            <button role="tab" aria-selected="true"><Network size={14} /> Objects</button>
            <button role="tab" aria-selected="false"><Braces size={14} /> Relations</button>
            <button role="tab" aria-selected="false"><Quote size={14} /> Evidence</button>
          </div>
          <div className={styles.objectList}>
            {OBJECTS.map((item, index) => (
              <button key={item.id} onClick={() => setSelected(index)} aria-pressed={selected === index}>
                <small>{item.type}</small><span>{item.label}</span><b data-tone="qualified">EVIDENCE</b>
              </button>
            ))}
          </div>
          <section className={styles.inspector}>
            <p>SEMANTIC OBJECT INSPECTOR</p>
            <h2>{object.label}</h2>
            <p>{object.detail}</p>
            <dl>
              <div><dt>Stable key</dt><dd>{object.id}</dd></div>
              <div><dt>Source version</dt><dd>{SOURCE.version}</dd></div>
              <div><dt>Location</dt><dd>p.{SOURCE.page} · {SOURCE.bbox}</dd></div>
              <div><dt>Source digest</dt><dd>{SOURCE.digest}</dd></div>
            </dl>
          </section>
        </article>

        <aside className={styles.answer}>
          <div><Search size={15} /><span>How often does FP-200 need servicing?</span></div>
          <p>
            Every <strong>2,000 operating hours</strong>. This interval is from revision C and
            replaces the 1,500-hour interval in revision B.
          </p>
          <button onClick={() => { setSelected(1); setMobileView("source"); }}><Quote size={13} /> Open citation · p.12</button>
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
