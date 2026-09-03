import styles from "./knowledge-compiler-diagram.module.css";

/**
 * Where the neighbouring categories act on the same pipeline.
 *
 * Masterplan 13.11 asks for a visual comparison on the category page, and the prose beneath it
 * already argues the distinction four times. What prose cannot do is show that these are not
 * four competing products but four different spans of one line: enterprise search acts on the
 * document, a graph is one representation in the middle, RAG acts at the far end at question
 * time, and the compiler is the span.
 *
 * Drawn rather than illustrated. No glow, no orb, no particles -- six labelled stages and four
 * brackets, in the page's own type and hairlines, so it reads the same as the tables around it.
 * Everything scales from the viewBox, so there is no second mobile drawing to keep in step.
 */

const STAGES = ["SOURCES", "READ", "STRUCTURE", "EVIDENCE", "WORLD", "PROJECTIONS"];

/** first stage, last stage, who acts there, and what they do. */
const SPANS: Array<[number, number, string, string]> = [
  [0, 0, "Enterprise search", "finds the document"],
  [2, 2, "Knowledge graph", "stores objects and relations"],
  [5, 5, "RAG", "retrieves chunks at question time"],
  [0, 5, "Knowledge Compiler", "compiles, binds evidence to regions, and versions the result"],
];

const LEFT = 190;
const STAGE_WIDTH = 120;
const STAGE_GAP = 10;
const ROW_TOP = 130;
const ROW_HEIGHT = 42;

const startOf = (index: number) => LEFT + index * (STAGE_WIDTH + STAGE_GAP);
const endOf = (index: number) => startOf(index) + STAGE_WIDTH;

export default function KnowledgeCompilerDiagram() {
  return (
    <svg
      className={styles.diagram}
      viewBox="0 0 980 316"
      role="img"
      aria-labelledby="compile-span-title compile-span-desc"
    >
      <title id="compile-span-title">Where each category acts on the compile pipeline</title>
      <desc id="compile-span-desc">
        One pipeline in six stages: sources, read, structure, evidence, world, projections.
        Enterprise search acts at sources, finding the document. A knowledge graph is the
        structure stage, storing objects and relations. RAG acts at projections, retrieving
        chunks at question time. A Knowledge Compiler spans all six: it compiles, binds evidence
        to regions, and versions the result.
      </desc>

      <text className={styles.eyebrow} x="0" y="20">THE COMPILE PIPELINE</text>

      {STAGES.map((stage, index) => (
        <g key={stage}>
          <rect className={styles.stage} x={startOf(index)} y="34" width={STAGE_WIDTH} height="52" />
          <text className={styles.stageLabel} x={startOf(index) + STAGE_WIDTH / 2} y="65">{stage}</text>
          {index < STAGES.length - 1 ? (
            <path
              className={styles.flow}
              d={`M${endOf(index)} 60 H${startOf(index + 1) - 3}`}
              markerEnd="url(#compile-span-arrow)"
            />
          ) : null}
        </g>
      ))}

      <defs>
        <marker id="compile-span-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path className={styles.arrowHead} d="M0 0 L6 3 L0 6 z" />
        </marker>
      </defs>

      {SPANS.map(([from, to, who, what], row) => {
        const y = ROW_TOP + row * ROW_HEIGHT;
        const x0 = startOf(from);
        const x1 = endOf(to);
        const whole = from === 0 && to === STAGES.length - 1;
        /*
          The note is centred under its span except where that would push it off the drawing.
          A span over the last stage alone sits at x=900 of 980, so a centred note runs past the
          edge; anchoring it to the end of the bracket keeps it inside without measuring text.
        */
        const centre = (x0 + x1) / 2;
        const anchor = centre > 700 ? { x: x1, className: styles.whatEnd }
          : centre < 280 ? { x: x0, className: styles.whatStart }
          : { x: centre, className: styles.whatMiddle };
        return (
          <g key={who} className={whole ? styles.whole : undefined}>
            <text className={styles.who} x="170" y={y + 4}>{who}</text>
            {/* A bracket rather than a bar: the ticks say which stages the span ends on. */}
            <path className={styles.bracket} d={`M${x0} ${y - 7} V${y} H${x1} V${y - 7}`} />
            <text className={`${styles.what} ${anchor.className}`} x={anchor.x} y={y + 20}>{what}</text>
          </g>
        );
      })}
    </svg>
  );
}
