import type { ComponentType } from "react";
import type { V34RouteKey } from "@/lib/v34/routes";
import s from "./covers.module.css";

/*
  The journal's own drawings: one cover per article, 640 by 320, drawn for the dark media panel
  the shared Figure provides. The words inside a drawing are its labels and nothing more, and the
  colours come from classes that read the V34 tokens.
*/

const Arrow = ({ x1, x2, y }: { x1: number; x2: number; y: number }) => (
  <>
    <path className={s.line} d={`M${x1} ${y}H${x2}`} />
    <path className={s.line} d={`M${x2 - 10} ${y - 8}L${x2} ${y}L${x2 - 10} ${y + 8}`} />
  </>
);

/** Originals become a compile step, then a World of linked records. */
export function CompilerCover() {
  const nodes: readonly (readonly [number, number])[] = [[490, 104], [575, 96], [540, 168], [478, 214], [580, 226]];
  const links: readonly (readonly [number, number])[] = [[0, 1], [0, 2], [1, 2], [2, 3], [2, 4]];
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Original documents pass through a compile step and become a World of linked records" xmlns="http://www.w3.org/2000/svg">
      {[0, 1, 2].map((i) => (
        <rect key={i} className={s.sheet} x={36 + i * 18} y={56 + i * 20} width={96} height={124} rx={6} />
      ))}
      <text className={s.label} x={104} y={268} textAnchor="middle">Originals</text>
      <Arrow x1={176} x2={246} y={160} />
      <rect className={s.sheet} x={262} y={110} width={116} height={100} rx={10} />
      <text className={s.label} x={320} y={167} textAnchor="middle">Compile</text>
      <Arrow x1={394} x2={448} y={160} />
      {links.map(([a, b]) => (
        <path key={`${a}-${b}`} className={s.line} d={`M${nodes[a]![0]} ${nodes[a]![1]}L${nodes[b]![0]} ${nodes[b]![1]}`} />
      ))}
      {nodes.map(([cx, cy]) => <circle key={`${cx}-${cy}`} className={s.node} cx={cx} cy={cy} r={10} />)}
      <text className={s.label} x={530} y={268} textAnchor="middle">World</text>
    </svg>
  );
}

/** A client reaches a World only through the scope its key grants. */
export function McpCover() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A client reaches a World through the scope its key grants, and the key can be revoked" xmlns="http://www.w3.org/2000/svg">
      {[30, 245, 460].map((x) => <rect key={x} className={s.sheet} x={x} y={112} width={150} height={96} rx={10} />)}
      <text className={s.label} x={105} y={168} textAnchor="middle">Client</text>
      <text className={s.label} x={320} y={168} textAnchor="middle">Scope</text>
      <text className={s.label} x={535} y={168} textAnchor="middle">World</text>
      <Arrow x1={188} x2={238} y={160} />
      <Arrow x1={403} x2={453} y={160} />
      <path className={s.dash} d="M320 214V248" />
      <circle className={s.node} cx={320} cy={252} r={8} />
      <text className={s.small} x={320} y={290} textAnchor="middle">Revocable key</text>
    </svg>
  );
}

/** Two revisions of a source, and the approved answer traced to the later one. */
export function RevisionCover() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="An earlier and a later revision of a source lead to the approved revision" xmlns="http://www.w3.org/2000/svg">
      <rect className={s.sheet} x={30} y={196} width={150} height={64} rx={8} />
      <rect className={s.sheet} x={245} y={146} width={150} height={64} rx={8} />
      <rect className={s.sheet} x={460} y={96} width={150} height={64} rx={8} />
      <text className={s.small} x={105} y={234} textAnchor="middle">Revision A</text>
      <text className={s.small} x={320} y={184} textAnchor="middle">Revision B</text>
      <text className={s.small} x={535} y={134} textAnchor="middle">Approved</text>
      <path className={s.line} d="M180 228H212V178H245" />
      <path className={s.line} d="M395 178H427V128H460" />
      <circle className={s.node} cx={535} cy={190} r={10} />
    </svg>
  );
}

/** Method, source and result overlap, and the limits sit with them. */
export function ResearchCover() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Method, source and result overlap in one research record" xmlns="http://www.w3.org/2000/svg">
      {/* Each label names its circle from outside it: inside, the 20px label's box met another
          circle's outline at every width (overlap-audit, /journal and /journal/research). */}
      <circle className={s.line} cx={250} cy={130} r={84} />
      <circle className={s.line} cx={390} cy={130} r={84} />
      <circle className={s.line} cx={320} cy={186} r={84} />
      <text className={s.small} x={250} y={28} textAnchor="middle">Method</text>
      <text className={s.small} x={390} y={28} textAnchor="middle">Source</text>
      <text className={s.small} x={320} y={306} textAnchor="middle">Result</text>
      <circle className={s.node} cx={320} cy={148} r={10} />
    </svg>
  );
}

/** The cover of each live journal article; a live article without one fails the index test. */
export const COVERS: Partial<Record<V34RouteKey, ComponentType>> = {
  "journal-compiler": CompilerCover,
  "journal-mcp": McpCover,
  "journal-revision": RevisionCover,
  "journal-research": ResearchCover,
};
