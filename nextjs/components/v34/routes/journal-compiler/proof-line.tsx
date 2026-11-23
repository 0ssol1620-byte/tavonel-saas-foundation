import s from "./proof-line.module.css";

const STEPS = ["Source version", "Evidence region", "Object and relation", "Compiled World"] as const;
const WIDTH = 130;
const STEP = (600 - WIDTH) / (STEPS.length - 1);

/** The compile contract as a chain: each step keeps a link to the one before it. */
export function ProofLine() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={`From left to right: ${STEPS.join(", ")}`} xmlns="http://www.w3.org/2000/svg">
      {STEPS.map((step, i) => {
        const x = 20 + i * STEP;
        const [first, ...rest] = step.split(" ");
        return (
          <g key={step}>
            <rect className={s.box} x={x} y={106} width={WIDTH} height={108} rx={10} />
            <text className={s.label} x={x + WIDTH / 2} y={154} textAnchor="middle">{first}</text>
            <text className={s.label} x={x + WIDTH / 2} y={180} textAnchor="middle">{rest.join(" ")}</text>
            {i > 0 ? <path className={s.line} d={`M${x - (STEP - WIDTH) + 6} 160H${x - 6}M${x - 16} 152L${x - 6} 160L${x - 16} 168`} /> : null}
          </g>
        );
      })}
    </svg>
  );
}
