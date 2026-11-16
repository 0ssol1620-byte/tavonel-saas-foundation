import s from "./company.module.css";

/**
 * The drawing for /company: a stack of source documents on the left, the World they compile into in
 * the middle, and two ways out on the right, an AI client reading it and a signed package leaving
 * with its owner. Drawn for this page only. Colours are the V34 tokens through the sheet; the caption
 * beside it says the same in words.
 */
export function CompanyArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Source documents compile into a World. An AI client reads the World, and a signed package leaves with its owner." xmlns="http://www.w3.org/2000/svg">
      {/* sources */}
      <rect className={s.node} x="40" y="80" width="104" height="72" rx="6" />
      <rect className={s.node} x="40" y="168" width="104" height="72" rx="6" />
      <path className={s.line} d="M58 104h68M58 124h48M58 192h68M58 212h48" />
      <text className={s.cap} x="40" y="272">Your sources</text>
      {/* the World */}
      <path className={s.arrow} d="M156 160h76m-8 -6l8 6l-8 6" />
      <circle className={s.world} cx="320" cy="160" r="68" />
      <circle className={s.dot} cx="296" cy="140" r="6" />
      <circle className={s.dot} cx="338" cy="132" r="6" />
      <circle className={s.dot} cx="326" cy="186" r="6" />
      <circle className={s.dot} cx="290" cy="178" r="6" />
      <path className={s.line} d="M296 140L338 132L326 186L290 178L296 140M338 132L290 178" />
      <text className={s.cap} x="320" y="272" textAnchor="middle">A World</text>
      {/* two ways out */}
      <path className={s.arrow} d="M396 136h60m-8 -6l8 6l-8 6" />
      <path className={s.arrow} d="M396 184h60m-8 -6l8 6l-8 6" />
      <rect className={s.nodeOut} x="472" y="104" width="136" height="64" rx="6" />
      <text className={s.lab} x="488" y="142">AI client</text>
      <rect className={s.nodeOut} x="472" y="176" width="136" height="64" rx="6" />
      <text className={s.lab} x="488" y="214">Signed export</text>
    </svg>
  );
}
