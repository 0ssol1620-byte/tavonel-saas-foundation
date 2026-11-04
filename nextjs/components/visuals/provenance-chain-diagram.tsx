import DiagramFrame, { arrow, Lines, Step, styles } from "./diagram-frame";

/**
 * (b) Evidence provenance: answer -> citation -> region bbox -> page -> source version -> sha256.
 * The field names are the ones the Explore evidence workbench reads (evidenceId, page,
 * sourceVersionId), so the drawing names what an integrator will actually find in the payload.
 * The Region step carries a small page with its box drawn: the unit of evidence is a box on a
 * page, not a chunk of text.
 */
const CHAIN: ReadonlyArray<readonly [string, string, readonly [string, string]]> = [
  ["Answer", "answer", ["each sentence", "carries citations"]],
  ["Citation", "evidenceId", ["points to one", "region by ID"]],
  ["Region", "bbox", ["a box on the page,", "not a text chunk"]],
  ["Page", "page", ["the page the box", "sits on"]],
  ["Source version", "sourceVersionId", ["the exact revision", "that was read"]],
  ["sha256", "sha256:…", ["the bytes, hashed,", "so an edit shows"]],
];
const CAPTION = "Followed forward it is a citation. Followed back it is an audit, down to the bytes.";

const BOX = 150;
const GAP = 28;

/** A page with three text lines and the cited region boxed, drawn at (x, y). */
function PageGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <rect x={x + .5} y={y + .5} width="29" height="38" rx="3" className={styles.box} />
      <rect x={x + 5} y={y + 7} width="19" height="3" className={styles.text} />
      <rect x={x + 3} y={y + 14} width="23" height="9" rx="1.5" className={styles.evidenceFill} />
      <rect x={x + 5} y={y + 28} width="15" height="3" className={styles.text} />
    </g>
  );
}

export default function ProvenanceChainDiagram({ className }: { className?: string }) {
  return (
    <DiagramFrame
      className={className}
      title="How an answer traces back to its source"
      desc={`Six links, each resolving to the next: ${CHAIN.map(([label, field, note]) => `${label} (${field}), ${note.join(" ")}`).join("; ")}. ${CAPTION}`}
      wide={{
        width: 1040,
        height: 186,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>PROVENANCE</text>
            {CHAIN.map(([label, field, note], i) => {
              const x = i * (BOX + GAP);
              return (
                <Step key={label} i={i}>
                  <rect x={x + .5} y="32.5" width={BOX - 1} height="110" rx="10" className={i === 2 ? `${styles.boxStrong} ${styles.evidence}` : styles.box} />
                  <text x={x + 14} y="58" className={styles.label}>{label}</text>
                  <text x={x + 14} y="80" className={styles.mono}>{field}</text>
                  <Lines x={x + 14} y={106} lines={note} className={styles.note} />
                  {i === 2 ? <PageGlyph x={x + 106} y={44} /> : null}
                  {i === CHAIN.length - 1 ? null : <path d={arrow(x + BOX + 4, 86, GAP - 8)} className={styles.line} />}
                </Step>
              );
            })}
            <text x="0" y="174" className={styles.note}>{CAPTION}</text>
          </>
        ),
      }}
      tall={{
        width: 360,
        height: 28 + CHAIN.length * 74 + 34,
        body: (
          <>
            <text x="0" y="14" className={styles.eyebrow}>PROVENANCE</text>
            {CHAIN.map(([label, field, note], i) => {
              const y = 28 + i * 74;
              return (
                <Step key={label} i={i}>
                  <rect x=".5" y={y + .5} width="359" height="59" rx="10" className={i === 2 ? `${styles.boxStrong} ${styles.evidence}` : styles.box} />
                  <text x="16" y={y + 24} className={styles.label}>{label}</text>
                  <text x={i === 2 ? 300 : 344} y={y + 24} className={styles.mono} textAnchor="end">{field}</text>
                  <text x="16" y={y + 45} className={styles.note}>{note.join(" ")}</text>
                  {i === 2 ? <PageGlyph x={316} y={y + 10} /> : null}
                  {i === CHAIN.length - 1 ? null : <path d={arrow(36, y + 62, 12, true)} className={styles.line} />}
                </Step>
              );
            })}
            <Lines x={0} y={28 + CHAIN.length * 74 + 8} lines={["Followed forward it is a citation.", "Followed back it is an audit, down to the bytes."]} className={styles.note} />
          </>
        ),
      }}
    />
  );
}
