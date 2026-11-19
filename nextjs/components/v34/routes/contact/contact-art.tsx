import s from "./contact.module.css";

const STEPS = ["Message", "Read by a person", "Reply"] as const;
// WO-CI-36: the nodes are 160 wide on a 200 step (40 left, 40 right, 40 between), and a label starts 16 in. The longest
// label, "Read by a person", is drawn 114 units wide in the page's face and about 136 in a wider fallback face (Verdana):
// the 144 units a node leaves it clear the outline by at least 8 units, which is 3.6px at the figure's smallest scale
// (320px wide) -- over the 2px the overlap audit asks. At 144 wide the same label crossed the edge in the wider face.
const X0 = 40;
const STEP = 200;
const WIDTH = 160;

/**
 * The drawing for /contact: the three steps an inquiry takes, from the message to a person to a
 * reply, with a small envelope on the first and a person's mark on the second. Drawn for this page
 * only. Colours are the V34 tokens through the sheet; the caption beside it says the same in words.
 */
export function ContactArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="An inquiry, step by step: a message, read by a person, then a reply." xmlns="http://www.w3.org/2000/svg">
      {STEPS.map((label, index) => {
        const x = X0 + index * STEP;
        const person = index === 1;
        return (
          <g key={label}>
            <rect className={person ? s.nodePerson : s.node} x={x} y="104" width={WIDTH} height="112" rx="8" />
            <text className={s.num} x={x + 16} y="136">{String(index + 1).padStart(2, "0")}</text>
            <text className={s.lab} x={x + 16} y="196">{label}</text>
            {index < STEPS.length - 1 ? <path className={s.arrow} d={`M${x + WIDTH + 6} 160h${STEP - WIDTH - 12}m-8 -6l8 6l-8 6`} /> : null}
          </g>
        );
      })}
      {/* envelope on the message */}
      <rect className={s.mark} x={X0 + WIDTH - 44} y="124" width="28" height="20" rx="3" />
      <path className={s.mark} d={`M${X0 + WIDTH - 44} 127l14 10l14 -10`} />
      {/* a person on the middle step */}
      <circle className={s.markFill} cx={X0 + STEP + WIDTH - 30} cy="130" r="6" />
      <path className={s.mark} d={`M${X0 + STEP + WIDTH - 40} 150a10 10 0 0 1 20 0`} />
    </svg>
  );
}
