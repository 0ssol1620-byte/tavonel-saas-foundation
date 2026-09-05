import styles from "./compiler-contract-diagram.module.css";

/**
 * What happens between a source changing and a new World existing.
 *
 * The landing films carry this as motion; a product page has to be able to say it precisely, and
 * the precise version has a fork in it that a sentence keeps losing: unaffected knowledge is
 * carried over untouched while affected knowledge is rebuilt, and the two halves are then
 * compared against what a full rebuild would have produced before anything publishes.
 *
 * The honest part of the drawing is the stroke. Five of these stages run in this deployment and
 * five do not, and a flowchart drawn in one weight tells a reader that all ten do. Solid is
 * built here; dashed is the contract this compiler is written to and does not yet execute. The
 * legend says so in the drawing rather than in a caption someone can crop.
 *
 * Nothing here animates, so `prefers-reduced-motion` has nothing to remove -- it is the same
 * drawing either way. Every size is a user unit on the viewBox, so there is one drawing rather
 * than a desktop one and a phone one that fall out of step.
 */

type Stage = {
  id: string;
  title: string;
  detail: string;
  /** `built` renders solid, `direction` dashed. The legend is generated from the same two words. */
  state: "built" | "direction";
  /** Optional state hue, from the product's four. Absent means the neutral hairline. */
  tone?: "reused" | "changed" | "verified" | "unresolved";
  x: number;
  y: number;
  width: number;
};

const BOX_H = 54;
const WIDE = 236;
const NARROW = 180;

/** Centre-anchored, because every row below is described by where its middle sits. */
const at = (centre: number, y: number, width = WIDE) => ({ x: centre - width / 2, y, width });

const STAGES: readonly Stage[] = [
  { id: "source-change", title: "SOURCE CHANGE", detail: "a new revision of one file", state: "built", ...at(490, 48) },
  { id: "semantic-diff", title: "SEMANTIC DIFF", detail: "what the change means, not which bytes moved", state: "built", ...at(490, 140) },
  { id: "dependency-impact", title: "DEPENDENCY IMPACT", detail: "which units stand on the changed region", state: "built", ...at(490, 232) },
  { id: "preserved", title: "UNAFFECTED → PRESERVED", detail: "carried over untouched", state: "direction", tone: "reused", ...at(250, 330) },
  { id: "recompiled", title: "AFFECTED → RECOMPILED", detail: "rebuilt from the new revision", state: "direction", tone: "changed", ...at(730, 330) },
  { id: "equivalence", title: "EQUIVALENCE", detail: "selective result against a full rebuild", state: "direction", ...at(490, 428) },
  { id: "pass", title: "PASS", detail: "they match", state: "direction", tone: "verified", ...at(300, 520, NARROW) },
  { id: "refuse", title: "REFUSE", detail: "they do not", state: "direction", tone: "unresolved", ...at(680, 520, NARROW) },
  { id: "new-world", title: "NEW WORLD", detail: "a candidate a person activates", state: "built", ...at(300, 598) },
  { id: "previous-world", title: "PREVIOUS WORLD KEPT", detail: "nothing publishes; the active version stands", state: "built", ...at(680, 598) },
];

const stage = (id: string) => STAGES.find((entry) => entry.id === id)!;
const centreOf = (id: string) => { const box = stage(id); return box.x + box.width / 2; };
const bottomOf = (id: string) => stage(id).y + BOX_H;

/** A straight drop from one box to the next, ending in the arrowhead. */
function drop(from: string, to: string) {
  return `M${centreOf(from)} ${bottomOf(from)} V${stage(to).y - 4}`;
}

/**
 * A fork: down out of one box, across the gutter, then down into each child.
 *
 * Drawn as one path per child rather than a tee plus two stubs, so each branch is a single
 * stroke that ends in its own arrowhead and nothing is left dangling if a row moves.
 */
function fork(from: string, to: string) {
  const mid = bottomOf(from) + 20;
  return `M${centreOf(from)} ${bottomOf(from)} V${mid} H${centreOf(to)} V${stage(to).y - 4}`;
}

/** The reverse of a fork: two branches meeting above a shared box. */
function merge(from: string, to: string) {
  const mid = stage(to).y - 24;
  return `M${centreOf(from)} ${bottomOf(from)} V${mid} H${centreOf(to)} V${stage(to).y - 4}`;
}

const EDGES: ReadonlyArray<{ id: string; d: string }> = [
  { id: "source-change→semantic-diff", d: drop("source-change", "semantic-diff") },
  { id: "semantic-diff→dependency-impact", d: drop("semantic-diff", "dependency-impact") },
  { id: "dependency-impact→preserved", d: fork("dependency-impact", "preserved") },
  { id: "dependency-impact→recompiled", d: fork("dependency-impact", "recompiled") },
  { id: "preserved→equivalence", d: merge("preserved", "equivalence") },
  { id: "recompiled→equivalence", d: merge("recompiled", "equivalence") },
  { id: "equivalence→pass", d: fork("equivalence", "pass") },
  { id: "equivalence→refuse", d: fork("equivalence", "refuse") },
  { id: "pass→new-world", d: drop("pass", "new-world") },
  { id: "refuse→previous-world", d: drop("refuse", "previous-world") },
];

export default function CompilerContractDiagram() {
  return (
    /*
      The drawing keeps a legible width and its own container scrolls, rather than shrinking to
      a third size on a phone -- a picture of a diagram is not a diagram. `tabIndex` is what
      makes a scrollable region reachable from the keyboard.
    */
    <div className={styles.scroller} tabIndex={0} role="group" aria-label="Compiler contract flow, scrollable">
      <svg
        className={styles.diagram}
        data-contract-flow=""
        viewBox="0 0 980 664"
        role="img"
        aria-labelledby="contract-flow-title contract-flow-desc"
      >
      <title id="contract-flow-title">What a source change does to a Compiled World</title>
      <desc id="contract-flow-desc">
        A source change is read as a semantic diff, which is resolved into dependency impact.
        Impact splits knowledge in two: unaffected units are preserved untouched, affected units
        are recompiled from the new revision. The two halves are compared against what a full
        rebuild would have produced. If they match, the compile passes and a new candidate World
        is offered for a person to activate; if they do not match, it refuses to publish and the
        previously active World stands. Five stages are drawn solid because they run in this
        deployment: source change, semantic diff, dependency impact, new World and the preserved
        previous World. The selective preserve and recompile step, the equivalence comparison and
        its pass or refuse outcome are drawn dashed, because they are the contract this compiler
        is written to rather than what it executes here.
      </desc>

      <defs>
        <marker id="contract-flow-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path className={styles.arrowHead} d="M0 0 L6 3 L0 6 z" />
        </marker>
      </defs>

      <text className={styles.eyebrow} x="0" y="18">SOURCE CHANGE → NEW WORLD</text>

      {/* The legend is part of the drawing: the stroke weight is carrying a claim, so it is named. */}
      <g className={styles.legend}>
        <path className={styles.legendBuilt} d="M690 14 H726" />
        <text x="734" y="18">RUNS IN THIS DEPLOYMENT</text>
        <path className={styles.legendDirection} d="M690 32 H726" />
        <text x="734" y="36">DIRECTION</text>
      </g>

      {EDGES.map((edge) => (
        <path key={edge.id} className={styles.edge} d={edge.d} markerEnd="url(#contract-flow-arrow)" />
      ))}

      {STAGES.map((box) => (
        <g key={box.id} className={styles.stage} data-contract-stage={box.id} data-state={box.state} data-tone={box.tone ?? "neutral"}>
          <rect className={styles.frame} x={box.x} y={box.y} width={box.width} height={BOX_H} rx="2" />
          <text className={styles.title} x={box.x + box.width / 2} y={box.y + 24}>{box.title}</text>
          <text className={styles.detail} x={box.x + box.width / 2} y={box.y + 42}>{box.detail}</text>
        </g>
      ))}
      </svg>
    </div>
  );
}
