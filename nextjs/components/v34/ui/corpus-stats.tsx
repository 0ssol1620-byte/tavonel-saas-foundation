import s from "./corpus-stats.module.css";

export interface CorpusStat {
  readonly label: string;
  readonly value: number | string;
}

/**
 * Figures that were computed from the corpus or the catalog by the caller. This component prints
 * what it is given and holds no number of its own.
 */
export function CorpusStats({ stats }: { stats: readonly CorpusStat[] }) {
  return (
    <dl className={s.grid}>
      {stats.map((stat) => (
        <div key={stat.label} className={s.stat}>
          <dt className={s.label}>{stat.label}</dt>
          <dd className={s.value}>{typeof stat.value === "number" ? stat.value.toLocaleString("en-US") : stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
