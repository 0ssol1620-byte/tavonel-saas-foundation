import s from "./security.module.css";

const STAGES = ["Isolate", "Sanitize", "Compile", "Review"] as const;
const X0 = 48;
const STEP = 144;
const WIDTH = 112;

/**
 * The drawing for /security: the four stages a document passes inside its workspace boundary, the
 * automated three bracketed apart from the person who decides, and a lock on the last. Drawn for
 * this page only. Colours are the V34 tokens through the sheet; the drawing carries no text a
 * reader needs, because the caption beside it and the section below say the same in words.
 */
export function SecurityArt() {
  const last = X0 + (STAGES.length - 1) * STEP;
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Four stages inside a workspace boundary: isolate, sanitize, compile and review. A lock sits on the review stage." xmlns="http://www.w3.org/2000/svg">
      <rect className={s.frame} x="24" y="24" width="592" height="272" rx="12" />
      <text className={s.cap} x="48" y="64">Workspace boundary</text>
      {STAGES.map((label, index) => {
        const x = X0 + index * STEP;
        const review = index === STAGES.length - 1;
        return (
          <g key={label}>
            <rect className={review ? s.nodeReview : s.node} x={x} y="112" width={WIDTH} height="96" rx="8" />
            <text className={s.num} x={x + 14} y="144">{String(index + 1).padStart(2, "0")}</text>
            <text className={s.lab} x={x + 14} y="188">{label}</text>
            {review ? null : <path className={s.arrow} d={`M${x + WIDTH + 6} 160h${STEP - WIDTH - 12}m-8 -6l8 6l-8 6`} />}
          </g>
        );
      })}
      {/* the lock, on the review stage */}
      <rect className={s.lock} x={last + 76} y="126" width="22" height="17" rx="3" />
      <path className={s.shackle} d={`M${last + 81} 126v-5a6 6 0 0 1 12 0v5`} />
      {/* the automated stages and the person, bracketed apart */}
      <path className={s.bracket} d={`M${X0} 228v10h${2 * STEP + WIDTH}v-10`} />
      <text className={s.bracketLabel} x={X0 + (2 * STEP + WIDTH) / 2} y="266" textAnchor="middle">Automated checks</text>
      <path className={s.bracket} d={`M${last} 228v10h${WIDTH}v-10`} />
      <text className={s.bracketLabel} x={last + WIDTH / 2} y="266" textAnchor="middle">A person</text>
    </svg>
  );
}
