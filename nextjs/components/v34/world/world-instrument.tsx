import Image from "next/image";
import { PUBLIC_CORPUS_PATH, PUBLIC_CORPUS_SRI, PUBLIC_CORPUS_STATS, publicCorpusIdsSha256, readPublicCorpus } from "@/lib/v34/public-corpus";
import { describeOverview, KIND_COLORS, worldAltText } from "@/lib/v34/world-geometry";
import { WorldIsland } from "./world-island";
import styles from "./world.module.css";

const count = (n: number) => n.toLocaleString("en-US");

/*
  The public reference corpus as a projection: the home hero (`variant="hero"`) and /world
  (`variant="full"`). Server component. Every number on it is computed from the verified corpus
  file. Without JavaScript, the static SVG and these counts are the whole instrument.
*/
export function WorldInstrument({ variant = "hero" }: { variant?: "hero" | "full" }) {
  const corpus = readPublicCorpus();
  const stats = PUBLIC_CORPUS_STATS(corpus);
  return (
    <section className={styles.instrument} aria-label="Public reference corpus" data-world-instrument="" data-variant={variant}>
      <p className={styles.caption}>
        Public reference corpus · {count(stats.records)} records · {count(stats.relations)} relationships
      </p>
      <WorldIsland
        variant={variant}
        corpusPath={PUBLIC_CORPUS_PATH}
        corpusIntegrity={PUBLIC_CORPUS_SRI}
        expected={{ records: stats.records, relations: stats.relations, idsSha: publicCorpusIdsSha256(corpus) }}
        overview={describeOverview(corpus, "layers")}
        legend={stats.layers.map((l) => ({ kind: l.kind, layer: l.layer, color: KIND_COLORS[l.kind], count: l.count }))}
      >
        <Image className={styles.fallbackImage} src="/v34/world-layers.svg" width={900} height={620} alt={worldAltText(corpus)} unoptimized priority={variant === "hero"} />
      </WorldIsland>
      <ul className={styles.domains} aria-label="Records by domain">
        {stats.domains.map((d) => (
          <li key={d.domain} className={styles.domain}>
            {d.domain} <b className={styles.domainCount}>{count(d.count)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
