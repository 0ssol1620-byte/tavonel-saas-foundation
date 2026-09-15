import styles from "./world-lifecycle.module.css";

/*
  Source → candidate → active → evidence, drawn once (G3-011).

  /docs/concepts defines the four terms well and had no picture, and this is the one page where a
  picture pays for itself: the terms are states of one thing, the transitions between them are
  where the product's two hard rules live -- nothing is served from a candidate, and promotion is
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
  ["Active", "the version answers come from", "A person promotes a candidate in a signed-in session. No API key can promote, and no compile promotes itself."],
  ["Evidence", "a page and a region, bound by digest", "Under every object in the active World. An object with no evidence is not published, and an answer that cannot cite one abstains."],
];

/** The two transitions that are not automatic, labelled on the arrow that carries them. */
const TRANSITIONS = ["compile", "promotion — a person", "reading it back"];

export function WorldLifecycle() {
  const width = 720;
  const boxWidth = 132;
  const gap = (width - boxWidth * 4) / 3;
  return (
    <figure className={styles.figure}>
      <svg
        viewBox={`0 0 ${width} 132`}
        className={styles.svg}
        role="img"
        aria-labelledby="world-lifecycle-title world-lifecycle-desc"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="world-lifecycle-title">The life of a Compiled World</title>
        <desc id="world-lifecycle-desc">
          Four states in sequence: Source, then Candidate after a compile, then Active after a
          person promotes it, then Evidence read back from the active version. The list below
          gives the same sequence in words.
        </desc>
        {STEPS.map(([name, gloss], index) => {
          const x = index * (boxWidth + gap);
          return (
            <g key={name}>
              <rect x={x} y={28} width={boxWidth} height={54} rx={3} className={styles.box} />
              <text x={x + boxWidth / 2} y={50} textAnchor="middle" className={styles.name}>{name}</text>
              <text x={x + boxWidth / 2} y={68} textAnchor="middle" className={styles.gloss}>{gloss.split(",")[0]}</text>
              {index < STEPS.length - 1 ? (
                <>
                  <line
                    x1={x + boxWidth + 6}
                    y1={55}
                    x2={x + boxWidth + gap - 10}
                    y2={55}
                    className={styles.arrow}
                  />
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
