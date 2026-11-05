import DiagramFrame, { arrow, Lines, Step, styles } from "./diagram-frame";

/**
 * (a) The compile, end to end: source -> CDR sanitize -> read -> identity -> lineage -> World ->
 * outputs. Seven stages in the order the system runs them; each one arrives in that order, once.
 * The stage notes say what each stage leaves behind, not what it is "powered by".
 */
const STAGES: ReadonlyArray<readonly [string, readonly [string, string]]> = [
  ["Source", ["the file you add", "or connect"]],
  ["CDR sanitize", ["rebuilt clean;", "receipt kept"]],
  ["Read", ["OCR or a native", "reader, per page"]],
  ["Identity", ["one stable ID", "per real thing"]],
  ["Lineage", ["which revision", "said what"]],
  ["World", ["validated; active", "only after review"]],
  ["Outputs", ["MCP · REST ·", "signed exports"]],
];
const CAPTION = "A stage that cannot do its job stops and says why. It never hands the next stage a guess.";

const BOX = 128;
const GAP = 24;

export default function CompilePipelineDiagram({ className }: { className?: string }) {
  return (
    <DiagramFrame
      className={className}
      title="How TAVONEL compiles a source"
      desc={`Seven stages in order: ${STAGES.map(([label, note]) => `${label}, ${note.join(" ")}`).join("; ")}. ${CAPTION}`}
      wide={{
        width: 1040,
        height: 178,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>COMPILE</text>
            {STAGES.map(([label, note], i) => {
              const x = i * (BOX + GAP);
              const last = i === STAGES.length - 1;
              return (
                <Step key={label} i={i}>
                  <rect x={x + .5} y="32.5" width={BOX - 1} height="92" rx="10" className={last ? `${styles.boxStrong} ${styles.evidence}` : styles.box} />
                  <text x={x + 14} y="60" className={styles.label}>{label}</text>
                  <Lines x={x + 14} y={86} lines={note} className={styles.note} />
                  {last ? null : <path d={arrow(x + BOX + 3, 78, GAP - 6)} className={styles.line} />}
                </Step>
              );
            })}
            <text x="0" y="166" className={styles.note}>{CAPTION}</text>
          </>
        ),
      }}
      tall={{
        width: 360,
        height: 28 + STAGES.length * 66 + 34,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>COMPILE</text>
            {STAGES.map(([label, note], i) => {
              const y = 28 + i * 66;
              const last = i === STAGES.length - 1;
              return (
                <Step key={label} i={i}>
                  <rect x=".5" y={y + .5} width="359" height="51" rx="10" className={last ? `${styles.boxStrong} ${styles.evidence}` : styles.box} />
                  <text x="16" y={y + 22} className={styles.label}>{label}</text>
                  <text x="16" y={y + 40} className={styles.note}>{note.join(" ")}</text>
                  {last ? null : <path d={arrow(36, y + 54, 12, true)} className={styles.line} />}
                </Step>
              );
            })}
            <Lines x={0} y={28 + STAGES.length * 66 + 8} lines={["A stage that cannot do its job stops and says why.", "It never hands the next stage a guess."]} className={styles.note} />
          </>
        ),
      }}
    />
  );
}
