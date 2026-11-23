import s from "../journal/covers.module.css";

/** One parcel, the records that describe it, and the review each record gets. */
export function Cover() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="One parcel is described by dated records, and each record is reviewed" xmlns="http://www.w3.org/2000/svg">
      <rect className={s.sheet} x={40} y={110} width={140} height={100} rx={10} />
      <text className={s.label} x={110} y={167} textAnchor="middle">Parcel</text>
      {[64, 144, 224].map((y) => <rect key={y} className={s.sheet} x={268} y={y - 16} width={150} height={52} rx={8} />)}
      {[64, 144, 224].map((y) => <path key={`l${y}`} className={s.line} d={`M180 160L268 ${y + 10}`} />)}
      <text className={s.small} x={343} y={78} textAnchor="middle">Title</text>
      <text className={s.small} x={343} y={158} textAnchor="middle">Planning</text>
      <text className={s.small} x={343} y={238} textAnchor="middle">Survey</text>
      {[74, 154, 234].map((y) => <path key={`r${y}`} className={s.line} d={`M418 ${y}H480`} />)}
      <circle className={s.node} cx={510} cy={154} r={10} />
      <path className={s.line} d="M480 74V234M480 154H498" />
      <text className={s.small} x={540} y={130} textAnchor="start">Review</text>
    </svg>
  );
}

/** A parcel leads to its record, and the record to a review. */
export function MethodFigure() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A parcel leads to its record, and the record goes to review" xmlns="http://www.w3.org/2000/svg">
      {[30, 245, 460].map((x) => <rect key={x} className={s.sheet} x={x} y={112} width={150} height={96} rx={10} />)}
      <text className={s.label} x={105} y={168} textAnchor="middle">Parcel</text>
      <text className={s.label} x={320} y={168} textAnchor="middle">Record</text>
      <text className={s.label} x={535} y={168} textAnchor="middle">Review</text>
      <path className={s.line} d="M188 160H238M228 152L238 160L228 168" />
      <path className={s.line} d="M403 160H453M443 152L453 160L443 168" />
    </svg>
  );
}
