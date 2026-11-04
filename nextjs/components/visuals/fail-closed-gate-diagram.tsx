import DiagramFrame, { arrow, Step, styles } from "./diagram-frame";

/**
 * (d) The fail-closed gate: what is refused, and why. Each row is a rule the product already
 * enforces (project constitution, "Fail closed on integrity violations"; the Ask surface's
 * page-and-bbox abstention; the OCR review hold) -- the drawing adds no rule of its own.
 * Refused outcomes stop at the gate; held ones wait for a person; only the last row crosses it.
 */
type Outcome = "refused" | "held" | "published";
const ROWS: ReadonlyArray<readonly [arrives: string, outcome: Outcome, word: string, why: string]> = [
  ["A link that does not resolve", "refused", "refused", "the vault is not emitted"],
  ["A source hash that does not match", "refused", "stopped", "nothing publishes from it"],
  ["A World that is only partly built", "refused", "refused", "never shown as active"],
  ["Two authoritative sources disagree", "held", "held", "a person decides, not a guess"],
  ["An answer with no page-and-bbox evidence", "refused", "abstains", "no citation, no answer"],
  ["A page the reader could not read well", "held", "review", "sent to a person with the page"],
  ["Everything that passes", "published", "published", "with its receipt"],
];
const CAPTION = "Broken knowledge fails where you can see it. It never arrives looking finished.";

const word = (o: Outcome) => (o === "refused" ? styles.refused : o === "held" ? styles.changed : styles.verified);
const GATE = 480;

export default function FailClosedGateDiagram({ className }: { className?: string }) {
  return (
    <DiagramFrame
      className={className}
      title="What the compile refuses, and why"
      desc={`${ROWS.map(([arrives, , w, why]) => `${arrives}: ${w}, ${why}`).join(". ")}. ${CAPTION}`}
      wide={{
        width: 900,
        height: 56 + ROWS.length * 40 + 30,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>WHAT ARRIVES</text>
            <text x={GATE} y="14" className={styles.eyebrow} textAnchor="middle">GATE</text>
            <text x={GATE + 40} y="14" className={styles.eyebrow}>WHAT HAPPENS</text>
            <path d={`M${GATE} 30V${36 + ROWS.length * 40}`} className={`${styles.boxStrong}`} strokeWidth="3" />
            {ROWS.map(([arrives, outcome, w, why], i) => {
              const y = 56 + i * 40;
              const pass = outcome === "published";
              return (
                <Step key={arrives} i={i}>
                  <text x="0" y={y + 5} className={pass ? styles.label : styles.note}>{arrives}</text>
                  <path d={arrow(360, y, pass ? GATE + 24 - 360 : GATE - 6 - 360)} className={`${styles.line} ${pass ? styles.verifiedLine : ""}`} />
                  {pass ? null : <path d={`M${GATE - 4} ${y - 9}v18`} className={`${styles.line} ${outcome === "refused" ? styles.refusedLine : styles.changedLine}`} strokeWidth="2" />}
                  <text x={GATE + 40} y={y + 5} className={`${styles.label} ${word(outcome)}`}>{w}</text>
                  <text x={GATE + 136} y={y + 5} className={styles.note}>{why}</text>
                </Step>
              );
            })}
            <text x="0" y={56 + ROWS.length * 40 + 18} className={styles.note}>{CAPTION}</text>
          </>
        ),
      }}
      tall={{
        width: 360,
        height: 28 + ROWS.length * 58 + 44,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>WHAT ARRIVES → WHAT HAPPENS</text>
            {ROWS.map(([arrives, outcome, w, why], i) => {
              const y = 28 + i * 58;
              return (
                <Step key={arrives} i={i}>
                  <rect x=".5" y={y + .5} width="359" height="49" rx="10" className={outcome === "published" ? `${styles.boxStrong} ${styles.verifiedLine}` : styles.box} />
                  <text x="14" y={y + 20} className={styles.note}>{arrives}</text>
                  <text x="14" y={y + 39} className={`${styles.label} ${word(outcome)}`}>{w}</text>
                  <text x="100" y={y + 39} className={styles.note}>{why}</text>
                </Step>
              );
            })}
            <text x="0" y={28 + ROWS.length * 58 + 14} className={styles.note}>Broken knowledge fails where you can see it.</text>
            <text x="0" y={28 + ROWS.length * 58 + 32} className={styles.note}>It never arrives looking finished.</text>
          </>
        ),
      }}
    />
  );
}
