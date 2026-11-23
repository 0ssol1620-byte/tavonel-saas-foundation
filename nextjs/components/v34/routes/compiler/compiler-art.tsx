import s from "./compiler.module.css";

/*
  The compiler illustration: one page with three regions boxed, and a record for each region on the
  right, joined by a line from the region to its record. Every colour is a token in the sheet; the
  numbers here are drawing coordinates, not figures.
*/
export function CompilerArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A page with three boxed regions, each joined by a line to the record that was compiled from it">
      <rect className={s.page} x="60" y="20" width="210" height="250" rx="4" />
      <path className={s.line} d="M78 38H168M78 121H250M78 183H250" />

      <rect className={s.region} x="76" y="64" width="178" height="46" rx="2" />
      <path className={s.line} d="M86 76H236M86 87H220M86 98H240" />
      <rect className={s.region} x="76" y="132" width="178" height="40" rx="2" />
      <path className={s.line} d="M86 144H240M86 156H210" />
      <rect className={s.region} x="76" y="194" width="178" height="56" rx="2" />
      <path className={s.line} d="M86 206H238M86 218H224M86 230H240" />

      <path className={s.link} d="M254 87H404M254 152H404M254 222H404" />
      <path className={s.head} d="M404 81L414 87L404 93ZM404 146L414 152L404 158ZM404 216L414 222L404 228Z" />

      <rect className={s.record} x="420" y="65" width="170" height="44" rx="4" />
      <circle className={s.node} cx="440" cy="87" r="7" />
      <path className={s.line} d="M458 82H570M458 94H540" />
      <rect className={s.record} x="420" y="130" width="170" height="44" rx="4" />
      <circle className={s.node} cx="440" cy="152" r="7" />
      <path className={s.line} d="M458 147H570M458 159H540" />
      <rect className={s.record} x="420" y="200" width="170" height="44" rx="4" />
      <circle className={s.node} cx="440" cy="222" r="7" />
      <path className={s.line} d="M458 217H570M458 229H540" />

      <text className={s.label} x="165" y="302" textAnchor="middle">Page</text>
      <text className={s.label} x="505" y="302" textAnchor="middle">Records</text>
    </svg>
  );
}
