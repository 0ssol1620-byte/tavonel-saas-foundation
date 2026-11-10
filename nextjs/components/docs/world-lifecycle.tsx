import styles from "./world-lifecycle.module.css";

/*
  Source → candidate → active → evidence, drawn once (G3-011).

  /docs/concepts defines the four terms well and had no picture, and this is the one page where a
  picture pays for itself: the terms are states of one thing, the transitions between them are
  where the product's two hard rules live -- nothing is served from a candidate, and activation is
  a person -- and a reader who has the sequence wrong writes an integration that polls for an
  answer a compile was never going to produce.

  Inline SVG rather than an image: it inherits the page's colour tokens, it scales without a
  second asset, and there is nothing to 404. The `<title>`/`<desc>` pair plus `role="img"` is
  what a screen reader announces, and the ordered list underneath is not a fallback -- it is the
  same content in the form that survives a printout, a text-only reader and a reduced-motion
  preference, which is why it is always rendered rather than hidden.

  No animation. Motion encodes meaning here and there is no meaning to encode: this is a
  definition, not a process a reader is watching run.
*/

const STEPS: ReadonlyArray<readonly [string, string, string]> = [
  ["Source", "an immutable document version", "Uploaded or collected. Addressed by the document plus the sha256 of its sanitized bytes; the same file uploaded twice is two sources, and nothing merges them."],
  ["Candidate", "a compile result nobody has accepted", "What a compile produces. Readable, reviewable, downloadable — and no answer is ever served from it."],
  ["Active", "the version answers come from", "A person activates a candidate in a signed-in session. No API key can activate, and no compile activates itself."],
  ["Evidence", "a page and a region, bound by digest", "Under every object in the active World. An object with no evidence is not published, and an answer that cannot cite one abstains."],
];

/*
  The three transitions, one word each on the arrow that carries them.

  They were sentences -- "promotion — a person" -- and a sentence does not fit: the gap between
  two boxes is 64 user units and that label drew about 92, centred, so its ends were printed over
  the boxes on either side. The fact it carried (that a person decides) is stated twice below, in
  the description a screen reader hears and in the list, which is where a fact belongs. The arrow
  gets the verb.
*/
const TRANSITIONS = ["compile", "activate", "read back"];

/*
  The gap between two boxes is derived from the longest edge label, not the other way round.

  With a fixed 64-unit gap the verbs still did not fit: "read back" draws about 70 units and
  "activate" 62, centred over that gap, so their ends sat on the borders of the boxes on either
  side (founder report 2026-11-10; e2e/overlap-audit.spec.ts measures it). A label's width is its
  character count times the mono advance plus the `.edge` letter-spacing, both set in
  world-lifecycle.module.css; LABEL_CLEARANCE is the space kept between a label's end and a box.
  The boxes take what is left: 108 units, where the longest name, "Candidate", draws about 70.
*/
const EDGE_FONT_SIZE = 12;
const EDGE_ADVANCE = EDGE_FONT_SIZE * (0.6 + 0.06);
const LABEL_CLEARANCE = 12;

const DESCRIPTION = "Four states in sequence: Source, then Candidate after a compile, then Active after a person activates it, then Evidence read back from the active version. The list below gives the same sequence in words.";

/*
  Two drawings of the same sequence, one shown at a time (world-lifecycle.module.css).

  The row needs about 520px to stay legible, so below 620px it used to scroll sideways inside the
  figure -- and the figure was the scroll container, so the definitions list under it was laid out
  at the row's 520px too and every line ran off the right edge of a phone. On a phone the states
  are stacked instead: each verb sits beside the arrow it labels, in a lane to the right of the
  arrow rather than across it, and nothing scrolls.
*/
function Row() {
  const width = 720;
  const gap = Math.ceil(Math.max(...TRANSITIONS.map(label => label.length)) * EDGE_ADVANCE) + LABEL_CLEARANCE * 2;
  const boxWidth = (width - gap * 3) / 4;
  return (
    <svg
      viewBox={`0 0 ${width} 132`}
      className={`${styles.svg} ${styles.row}`}
      role="img"
      aria-labelledby="world-lifecycle-title world-lifecycle-desc"
      preserveAspectRatio="xMidYMid meet"
    >
      <title id="world-lifecycle-title">The life of a Compiled World</title>
      <desc id="world-lifecycle-desc">{DESCRIPTION}</desc>
      {STEPS.map(([name], index) => {
        const x = index * (boxWidth + gap);
        return (
          <g key={name}>
            <rect x={x} y={28} width={boxWidth} height={54} rx={3} className={styles.box} />
            {/*
              One word per box.

              The gloss was printed under the name at 9.5px -- under the type floor, and about
              190 user units of text inside a 132-unit box, so it ran out of both sides of the
              rectangle it was describing. It is in the list below, in full and at a size a
              reader can read, which is the only place it was ever legible.
            */}
            <text x={x + boxWidth / 2} y={60} textAnchor="middle" className={styles.name}>{name}</text>
            {index < STEPS.length - 1 ? (
              <>
                <line x1={x + boxWidth + 6} y1={55} x2={x + boxWidth + gap - 10} y2={55} className={styles.arrow} />
                <polygon
                  points={`${x + boxWidth + gap - 10},55 ${x + boxWidth + gap - 17},51 ${x + boxWidth + gap - 17},59`}
                  className={styles.head}
                />
                <text x={x + boxWidth + gap / 2} y={44} textAnchor="middle" className={styles.edge}>
                  {TRANSITIONS[index]}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function Column() {
  const width = 300;
  const boxWidth = 150;
  const boxHeight = 44;
  const gap = 40;
  const x = 16;
  const arrowX = x + boxWidth / 2;
  return (
    <svg
      viewBox={`0 0 ${width} ${STEPS.length * boxHeight + (STEPS.length - 1) * gap + 2}`}
      className={`${styles.svg} ${styles.column}`}
      role="img"
      aria-labelledby="world-lifecycle-column-title world-lifecycle-column-desc"
      preserveAspectRatio="xMinYMin meet"
    >
      <title id="world-lifecycle-column-title">The life of a Compiled World</title>
      <desc id="world-lifecycle-column-desc">{DESCRIPTION}</desc>
      {STEPS.map(([name], index) => {
        const y = 1 + index * (boxHeight + gap);
        const arrowTop = y + boxHeight + 5;
        const arrowBottom = y + boxHeight + gap - 6;
        return (
          <g key={name}>
            <rect x={x} y={y} width={boxWidth} height={boxHeight} rx={3} className={styles.box} />
            <text x={arrowX} y={y + boxHeight / 2 + 4.5} textAnchor="middle" className={styles.name}>{name}</text>
            {index < STEPS.length - 1 ? (
              <>
                <line x1={arrowX} y1={arrowTop} x2={arrowX} y2={arrowBottom} className={styles.arrow} />
                <polygon points={`${arrowX},${arrowBottom} ${arrowX - 4},${arrowBottom - 7} ${arrowX + 4},${arrowBottom - 7}`} className={styles.head} />
                <text x={arrowX + LABEL_CLEARANCE} y={(arrowTop + arrowBottom) / 2 + 4} className={styles.edge}>
                  {TRANSITIONS[index]}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function WorldLifecycle() {
  return (
    <figure className={styles.figure} tabIndex={0} role="group" aria-label="Compiled World lifecycle diagram and definitions">
      <Row />
      <Column />
      <figcaption>
        <ol className={styles.list}>
          {STEPS.map(([name, gloss, detail]) => (
            <li key={name}>
              <b>{name}</b> — <i>{gloss}</i>. {detail}
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
