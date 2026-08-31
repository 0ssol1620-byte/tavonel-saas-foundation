"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Braces, FileText, Network, Quote, Search } from "lucide-react";
import Logomark from "@/components/logomark";
import styles from "@/app/explore/explore.module.css";

const OBJECTS = [
  { id: "claim-retention", type: "CLAIM", label: "Retention defaults to 30 days", evidence: "ev-01", status: "QUALIFIED" },
  { id: "policy-export", type: "POLICY", label: "Administrators can shorten retention", evidence: "ev-02", status: "QUALIFIED" },
  { id: "research-impact", type: "RESEARCH", label: "Selective downstream impact path", evidence: "not_yet", status: "RESEARCH FRONTIER" },
] as const;

const SOURCE = {
  name: "sample-retention-policy.pdf",
  digest: "sha256:3e118d4e...bf1c",
  version: "src_v_01",
  page: 4,
  bbox: "[118, 214, 886, 374]",
};

export default function ExploreCompiledWorld() {
  const [selected, setSelected] = useState(0);
  const [mobileView, setMobileView] = useState<"source" | "world">("source");
  const object = OBJECTS[selected];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><Logomark size={22} /><b>TAVONEL</b></Link>
        <span>DETERMINISTIC PRODUCT SAMPLE</span>
        <nav><Link href="/evidence">Evidence record</Link><Link href="/login">Sign in</Link></nav>
      </header>

      <section className={styles.intro}>
        <Link href="/" className={styles.back}><ArrowLeft size={14} /> Home</Link>
        <p>EXPLORE · NO LOGIN REQUIRED</p>
        <h1>Follow one fact<br />all the way back.</h1>
        <div className={styles.introCopy}>
          <p>This is a fixed, reproducible sample, not customer proof. Select a compiled object and TAVONEL reveals its source version, page region, relation, and answer citation.</p>
          <div><span data-tone="qualified">QUALIFIED</span><span data-tone="research">RESEARCH FRONTIER</span></div>
        </div>
      </section>

      <section className={styles.instrument} aria-label="Compiled World sample">
        <div className={styles.instrumentBar}>
          <div><small>WORLD</small><strong>sample-policy · v3 ACTIVE</strong></div>
          <div><small>OBJECTS</small><strong>2 QUALIFIED · 1 RESEARCH</strong></div>
          <div><small>PROVENANCE</small><strong>PAGE + BBOX BOUND</strong></div>
          <div><small>SAMPLE DIGEST</small><strong>{SOURCE.digest}</strong></div>
        </div>

        <div className={styles.mobileSwitch} role="group" aria-label="Sample view">
          <button aria-pressed={mobileView === "source"} onClick={() => setMobileView("source")}>Source</button>
          <button aria-pressed={mobileView === "world"} onClick={() => setMobileView("world")}>World</button>
        </div>

        <article className={styles.source} data-mobile-hidden={mobileView !== "source"}>
          <header><FileText size={15} /><span>{SOURCE.name}</span><b>PAGE {SOURCE.page}</b></header>
          <div className={styles.paper}>
            <p>4. Data retention and deletion</p>
            <p>Uploaded source material is retained for a default period of thirty days after a compile completes.</p>
            <mark data-selected={selected === 0}>Workspace administrators may configure a shorter retention period. Deletion requests are recorded in the workspace activity ledger.</mark>
            <p>Compiled exports remain under the customer&apos;s control and can be removed separately.</p>
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
                <small>{item.type}</small><span>{item.label}</span><b data-tone={item.status === "QUALIFIED" ? "qualified" : "research"}>{item.status}</b>
              </button>
            ))}
          </div>
          <section className={styles.inspector}>
            <p>SEMANTIC OBJECT INSPECTOR</p>
            <h2>{object.label}</h2>
            <dl>
              <div><dt>Stable key</dt><dd>{object.id}</dd></div>
              <div><dt>Evidence</dt><dd>{object.evidence}</dd></div>
              <div><dt>Source version</dt><dd>{object.evidence === "not_yet" ? "not_yet" : SOURCE.version}</dd></div>
              <div><dt>Location</dt><dd>{object.evidence === "not_yet" ? "not_yet" : `p.${SOURCE.page} · ${SOURCE.bbox}`}</dd></div>
            </dl>
          </section>
        </article>

        <aside className={styles.answer}>
          <div><Search size={15} /><span>How long is source material retained?</span></div>
          <p>Source material is retained for <strong>30 days by default</strong>. Workspace administrators can configure a shorter period.</p>
          <button onClick={() => { setSelected(0); setMobileView("source"); }}><Quote size={13} /> Open citation · p.4</button>
          <small>Answer generated from this deterministic compiled sample. No external model result is represented.</small>
        </aside>
      </section>

      <section className={styles.next}>
        <p>INPUT → COMPILED WORLD → GROUNDED USE</p>
        <h2>Bring your own sources when you are ready.</h2>
        <div><Link href="/login">Start in a private workspace</Link><Link href="/product/compiled-world">How Compiled Worlds work</Link></div>
      </section>
    </main>
  );
}