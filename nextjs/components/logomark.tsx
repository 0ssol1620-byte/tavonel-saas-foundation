/**
 * Nine cells, one lit.
 *
 * It is the interlude lattice at its smallest -- a structured field with a single cell in a
 * known state -- so the favicon, the nav, the workspace and the interlude are all the same idea
 * at four scales. Pure markup with no wordmark dependency, and it survives at 16px because it is
 * nothing but a grid.
 */
export default function Logomark({ size = 20 }: { size?: number }) {
  return (
    <svg className="logomark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const lit = row === 1 && col === 1;
          return (
            <rect
              key={`${row}-${col}`}
              x={3 + col * 7}
              y={3 + row * 7}
              width={5}
              height={5}
              rx={0.5}
              fill={lit ? "var(--verified)" : "none"}
              stroke={lit ? "none" : "currentColor"}
              strokeWidth={1}
              opacity={lit ? 1 : 0.42}
            />
          );
        }),
      )}
    </svg>
  );
}
