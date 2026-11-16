import type { ThreadPlanet } from "./research-data";
import s from "./research.module.css";

/*
  Two drawings, shapes only (no text, so nothing can fall below the type floor at a narrow width).
  Both sit on the figure's dark panel.
*/

/** The hero: a source page with one highlighted passage, and the records drawn from it. */
export function ResearchArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A source page with one highlighted passage, linked to two supported records and one uncertain record" xmlns="http://www.w3.org/2000/svg">
      <rect className={s.page} x="56" y="36" width="212" height="248" rx="6" />
      <path className={s.line} d="M80 74H244M80 96H226M80 118H244M80 184H236M80 206H210M80 228H244M80 250H190" />
      <rect className={s.passage} x="74" y="140" width="176" height="22" rx="4" />
      <path className={s.link} d="M250 151C300 151 330 90 402 90M250 151C300 151 330 160 402 160" />
      <path className={s.linkUncertain} d="M250 151C300 151 330 230 402 230" />
      <rect className={s.record} x="402" y="62" width="182" height="56" rx="6" />
      <rect className={s.record} x="402" y="132" width="182" height="56" rx="6" />
      <rect className={s.record} x="402" y="202" width="182" height="56" rx="6" />
      <circle className={s.dotOn} cx="428" cy="90" r="8" />
      <circle className={s.dotOn} cx="428" cy="160" r="8" />
      <circle className={s.dotOff} cx="428" cy="230" r="8" />
      <path className={s.line} d="M450 82H562M450 98H530M450 152H562M450 168H530M450 222H562M450 238H530" />
    </svg>
  );
}

/** The TRAPPIST-1 thread: the host star, its planets in order, and the habitable-zone band behind those the corpus relates to it. */
export function ThreadArt({ planets }: { planets: readonly ThreadPlanet[] }) {
  const first = 156;
  const last = 604;
  const step = planets.length > 1 ? (last - first) / (planets.length - 1) : 0;
  const x = (i: number) => first + i * step;
  const zoneIndexes = planets.flatMap((p, i) => (p.inZone ? [i] : []));
  const zoneStart = zoneIndexes.length ? x(Math.min(...zoneIndexes)) - 28 : 0;
  const zoneEnd = zoneIndexes.length ? x(Math.max(...zoneIndexes)) + 28 : 0;
  const inZone = zoneIndexes.length;
  return (
    <svg
      className={s.art}
      viewBox="0 0 640 320"
      role="img"
      aria-label={`The host star and ${planets.length} planets in order from it, ${inZone} of them in the habitable zone band`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {zoneIndexes.length ? <rect className={s.zone} x={zoneStart} y="104" width={zoneEnd - zoneStart} height="112" rx="8" /> : null}
      <path className={s.axis} d="M64 160H620" />
      <circle className={s.star} cx="64" cy="160" r="34" />
      {planets.map((planet, i) => (
        <circle key={planet.id} className={planet.inZone ? s.planetZone : s.planet} cx={x(i)} cy="160" r={planet.inZone ? 13 : 10} />
      ))}
    </svg>
  );
}
