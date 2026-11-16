import s from "./methods.module.css";

/*
  The methods illustration: four layers stacked from source file to relationship, joined by one
  line, each with a tick at its right edge for the check that stage carries. Every colour is a token
  in the sheet; the numbers here are drawing coordinates, not figures.
*/
export function MethodsArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Stacked layers, from a source file through an evidence region and a record to a relationship, each with a check mark">
      <path className={s.spine} d="M205 76V94M205 150V168M205 224V242" />

      <rect className={s.layer} x="40" y="20" width="330" height="56" rx="4" />
      <path className={s.line} d="M64 36H150M64 48H130M64 60H142M214 36H340M214 48H320M214 60H334" />

      <rect className={s.layer} x="40" y="94" width="330" height="56" rx="4" />
      <path className={s.line} d="M64 110H340M64 134H340" />
      <rect className={s.region} x="150" y="106" width="120" height="32" rx="2" />

      <rect className={s.layer} x="40" y="168" width="330" height="56" rx="4" />
      <circle className={s.node} cx="72" cy="196" r="8" />
      <path className={s.line} d="M96 190H340M96 204H300" />

      <rect className={s.layer} x="40" y="242" width="330" height="56" rx="4" />
      <path className={s.link} d="M90 270L205 256M205 256L320 274M90 270L320 274" />
      <circle className={s.node} cx="90" cy="270" r="8" />
      <circle className={s.node} cx="205" cy="256" r="8" />
      <circle className={s.node} cx="320" cy="274" r="8" />

      <circle className={s.tick} cx="396" cy="48" r="11" />
      <circle className={s.tick} cx="396" cy="122" r="11" />
      <circle className={s.tick} cx="396" cy="196" r="11" />
      <circle className={s.tick} cx="396" cy="270" r="11" />
      <path className={s.mark} d="M390 48L394 52L402 43M390 122L394 126L402 117M390 196L394 200L402 191M390 270L394 274L402 265" />

      <text className={s.label} x="424" y="56">Source file</text>
      <text className={s.label} x="424" y="130">Evidence region</text>
      <text className={s.label} x="424" y="204">Record</text>
      <text className={s.label} x="424" y="278">Relationship</text>
    </svg>
  );
}
