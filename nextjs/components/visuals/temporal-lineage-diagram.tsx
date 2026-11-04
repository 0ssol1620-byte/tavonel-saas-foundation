import DiagramFrame, { Step, styles } from "./diagram-frame";

/**
 * (c) Temporal lineage: three revisions of one source and, for each pair, what the compile found
 * between them. The state words carry the state colours and nothing else does (DESIGN_MASTER
 * §4.3): changed / added in the changed tone, reached in evidence, unchanged in muted ink.
 */
const REVISIONS = ["Revision 1", "Revision 2", "Revision 3"] as const;
type Row = readonly [word: string, tone: "changed" | "evidence" | "muted", note: string];
const PAIRS: ReadonlyArray<readonly Row[]> = [
  [["changed", "changed", "one clause's wording"], ["reached", "evidence", "objects citing it, rebuilt"], ["unchanged", "muted", "same identity, carried"]],
  [["added", "changed", "a new section"], ["reached", "evidence", "objects it now supports"], ["unchanged", "muted", "same identity, carried"]],
];
const CAPTION = "Each World is the one before it plus one change. The earlier World is kept, so you can ask what was true then.";

const tone = (t: Row[1]) => (t === "changed" ? styles.changed : t === "evidence" ? styles.evidenceInk : styles.note);

function Delta({ x, y, rows }: { x: number; y: number; rows: readonly Row[] }) {
  return (
    <>
      <rect x={x + .5} y={y + .5} width="299" height="91" rx="10" className={styles.box} />
      {rows.map(([word, t, note], r) => (
        <g key={word}>
          <text x={x + 14} y={y + 26 + r * 24} className={`${styles.label} ${tone(t)}`}>{word}</text>
          <text x={x + 104} y={y + 26 + r * 24} className={styles.note}>{note}</text>
        </g>
      ))}
    </>
  );
}

export default function TemporalLineageDiagram({ className }: { className?: string }) {
  const desc = `Three revisions of one source in order. ${PAIRS.map((rows, p) => `Between ${REVISIONS[p]} and ${REVISIONS[p + 1]}: ${rows.map(([w, , n]) => `${w}, ${n}`).join("; ")}`).join(". ")}. ${CAPTION}`;
  return (
    <DiagramFrame
      className={className}
      title="What changed between revisions"
      desc={desc}
      wide={{
        width: 1040,
        height: 250,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>LINEAGE</text>
            <path d="M40 74H1000" className={styles.line} />
            {REVISIONS.map((label, i) => {
              const x = 120 + i * 400;
              return (
                <Step key={label} i={i * 2}>
                  <text x={x} y="54" className={styles.label} textAnchor="middle">{label}</text>
                  <circle cx={x} cy="74" r="6" className={i === 2 ? `${styles.boxStrong} ${styles.evidence}` : styles.boxStrong} />
                  <text x={x} y="100" className={styles.mono} textAnchor="middle">{`World v${i + 1}`}</text>
                </Step>
              );
            })}
            {PAIRS.map((rows, p) => (
              <Step key={p} i={p * 2 + 1}>
                <path d={`M${170 + p * 400} 84v20h300v-20M${320 + p * 400} 104v10`} className={styles.line} />
                <Delta x={170 + p * 400} y={114} rows={rows} />
              </Step>
            ))}
            <text x="0" y="238" className={styles.note}>{CAPTION}</text>
          </>
        ),
      }}
      tall={{
        width: 360,
        height: 520,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>LINEAGE</text>
            <path d="M12 40V430" className={styles.line} />
            {REVISIONS.map((label, i) => {
              const y = 44 + i * 190;
              return (
                <Step key={label} i={i * 2}>
                  <circle cx="12" cy={y} r="6" className={i === 2 ? `${styles.boxStrong} ${styles.evidence}` : styles.boxStrong} />
                  <text x="30" y={y + 5} className={styles.label}>{label}</text>
                  <text x="356" y={y + 5} className={styles.mono} textAnchor="end">{`World v${i + 1}`}</text>
                </Step>
              );
            })}
            {PAIRS.map((rows, p) => (
              <Step key={p} i={p * 2 + 1}>
                <Delta x={44} y={78 + p * 190} rows={rows} />
              </Step>
            ))}
            <text x="0" y="478" className={styles.note}>Each World is the one before it plus one change.</text>
            <text x="0" y="496" className={styles.note}>The earlier World is kept, so you can ask</text>
            <text x="0" y="514" className={styles.note}>what was true then.</text>
          </>
        ),
      }}
    />
  );
}
