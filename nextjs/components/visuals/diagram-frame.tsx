import { useId, type CSSProperties, type ReactNode } from "react";
import styles from "./visuals.module.css";

/**
 * The shell every W1-L7 diagram renders through: one container, two drawings of the same data.
 *
 * The wide row is for a container of 1040px and up, the tall column for anything narrower (see
 * visuals.module.css). Both carry the same <title> and <desc>, because whichever one is showing
 * is the one a screen reader reaches; the hidden one is display:none and out of the tree.
 * Ids come from useId so two diagrams, or the same one twice, never share a label.
 */
export type Drawing = { width: number; height: number; body: ReactNode };

export default function DiagramFrame({ title, desc, wide, tall, className }: {
  title: string;
  desc: string;
  wide: Drawing;
  tall: Drawing;
  className?: string;
}) {
  const id = useId();
  const svg = (kind: "wide" | "tall", drawing: Drawing) => (
    <svg
      className={styles[kind]}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      role="img"
      aria-labelledby={`${id}${kind}t ${id}${kind}d`}
      focusable="false"
    >
      <title id={`${id}${kind}t`}>{title}</title>
      <desc id={`${id}${kind}d`}>{desc}</desc>
      {drawing.body}
    </svg>
  );
  return (
    <div className={className ? `${styles.frame} ${className}` : styles.frame}>
      {svg("wide", wide)}
      {svg("tall", tall)}
    </div>
  );
}

/** A group that arrives in sequence; `i` is its place in the order the system runs. */
export function Step({ i, children }: { i: number; children: ReactNode }) {
  return <g className={styles.step} style={{ "--i": i } as CSSProperties}>{children}</g>;
}

/** A right- or down-pointing arrow from (x, y), `length` long, head included. */
export function arrow(x: number, y: number, length: number, down = false): string {
  return down
    ? `M${x} ${y}v${length}m-4 -5l4 5l4 -5`
    : `M${x} ${y}h${length}m-5 -4l5 4l-5 4`;
}

/** Text lines under one another, so a two-line note stays one element. */
export function Lines({ x, y, lines, className, step = 16, anchor }: {
  x: number; y: number; lines: readonly string[]; className: string; step?: number; anchor?: "middle" | "end";
}) {
  return (
    <text x={x} y={y} className={className} textAnchor={anchor}>
      {lines.map((line, index) => <tspan key={line} x={x} dy={index === 0 ? 0 : step}>{line}</tspan>)}
    </text>
  );
}

export { styles };
