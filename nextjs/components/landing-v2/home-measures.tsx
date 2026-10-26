import Link from "next/link";
import type { Route } from "next";
import { formatFigure, HOME_MEASURES, type HomeMeasure, type Part } from "@/lib/home-measures";
import styles from "./home-measures.module.css";

/*
  Release 3, brief move 7: the receipted measurement band directly under the hero.

  Each number is printed inside a `data-claim` span naming the claims-pack id and the sha256 of the
  receipt it is bound to. `lib/landing-v2-page.test.ts` reads those two attributes against its
  allowlist and the receipt bytes, and fails on any other digit on the page. No motion: the band is
  a static record, so reduced motion has nothing to remove.

  FINAL-SPEC 2026-10-26 §2.2: a ledger, not three stat cards. One visible h2 carries the scope the
  deleted paragraph used to ("research", not a live rate); each row is the figure, then its label,
  its detail and must-say verbatim, then the receipt chip (`R-0x · date · sha256 xxxxxxxx`).
*/
const COPY = {
  /* Review 2026-10-26 B-1 (word budget): still says "research" -- the scope the deleted paragraph carried. */
  en: { title: "Research figures, with receipts." },
  ko: { title: "연구 측정값마다 영수증이 있습니다." },
};

function bound(measure: HomeMeasure, parts: Part[]) {
  return parts.map((part, index) =>
    typeof part === "string" ? part : (
      <span key={index} data-claim={measure.claim} data-claim-sha={measure.receipt.digest}>{formatFigure(part)}</span>
    ),
  );
}

export default function HomeMeasures({ korean = false }: { korean?: boolean }) {
  const locale = korean ? "ko" : "en";
  const copy = COPY[locale];
  return (
    <section className={styles.band} aria-labelledby="home-measures-title" data-home-measures>
      <div className="lv2-wrap">
        <h2 className={`lv2-h2 ${styles.title}`} id="home-measures-title">{copy.title}</h2>
        <ol className={styles.facts}>
          {HOME_MEASURES.map(measure => {
            const text = measure[locale];
            const { id, date, digest } = measure.receipt;
            return (
              <li className={styles.fact} key={measure.claim} data-claim-id={measure.claim}>
                <p className={styles.figure}>{bound(measure, text.figure)}</p>
                <div className={styles.body}>
                  <p className={styles.label}>{bound(measure, text.label)}</p>
                  <p className={styles.detail}>{bound(measure, text.detail)}</p>
                  <p className={styles.receipt}>
                    {/* Two unbreakable halves, so a narrow column wraps between them rather than inside the hash. */}
                    <Link href={`/research/notes#${id}` as Route} prefetch={false} data-receipt={id}>
                      <span>{`${id} · ${date} ·`}</span> <span>{`sha256 ${digest.slice(0, 8)}`}</span>
                    </Link>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
