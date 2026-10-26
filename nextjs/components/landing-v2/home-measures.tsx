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

  UX-L3 (UX-PLAN-2026-10-17 §5.3 R3): the band's head is Home's one section head -- `lv2-h2` and
  `lv2-scene-support`, the classes s2-s6 use -- so its H2 is the same size as its siblings. It was a
  24px title beside five 51.84px section H2s on the same page.
*/
const COPY = {
  en: {
    title: "Every research figure has a receipt.",
    scope: "Research runs on fixed document sets, each figure with its date and receipt. They describe those runs, not this service's live rates.",
    receipt: "Receipt",
  },
  ko: {
    title: "연구 측정값마다 영수증이 있습니다.",
    scope: "고정된 문서 세트에서 실행한 연구 측정이며, 각 수치에 날짜와 영수증이 붙어 있습니다. 해당 실행의 결과이며 이 서비스의 실시간 지표가 아닙니다.",
    receipt: "영수증",
  },
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
        <div className="lv2-scene-head">
          <h2 className="lv2-h2" id="home-measures-title">{copy.title}</h2>
          <p className="lv2-scene-support">{copy.scope}</p>
        </div>
        <ul className={styles.facts}>
          {HOME_MEASURES.map(measure => {
            const text = measure[locale];
            const { id, date, digest } = measure.receipt;
            return (
              <li className={styles.fact} key={measure.claim} data-claim-id={measure.claim}>
                <p className={styles.statement}>
                  <span className={styles.figure}>{bound(measure, text.figure)}</span>{" "}
                  <span className={styles.label}>{bound(measure, text.label)}</span>
                </p>
                <p className={styles.detail}>{bound(measure, text.detail)}</p>
                <p className={styles.receipt}>
                  {/* Two unbreakable halves, so a narrow column wraps between them rather than inside the hash. */}
                  <Link href={`/research/notes#${id}` as Route} prefetch={false} data-receipt={id}>
                    <span>{`${copy.receipt} ${id} · ${date} ·`}</span> <span>{`sha256 ${digest.slice(0, 8)}`}</span>
                  </Link>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
