import type { CorpusNode } from "@/lib/v34/world-geometry";
import type { PublicCorpus } from "@/lib/v34/public-corpus";

/*
  What /research reads from the public reference corpus. Everything the page prints about the
  TRAPPIST-1 thread (the planets, which of them the corpus relates to the habitable zone, the
  zone's own status and note, the sources) is looked up here and nowhere typed. A record the page
  needs and the corpus does not hold is an error, not a blank: the page fails closed.
*/

export interface ThreadSource {
  readonly id: string;
  /** The corpus's own label for what the source is: "2017 discovery", "Source catalog". */
  readonly kind: string;
  readonly label: string;
  readonly note: string;
  readonly href: string;
  /** A source the corpus lists as a reference only, with no dataset loaded. */
  readonly catalog: boolean;
}

export interface ThreadPlanet {
  readonly id: string;
  readonly label: string;
  readonly inZone: boolean;
  readonly status: string;
}

export interface ResearchThread {
  readonly star: CorpusNode;
  readonly zone: CorpusNode;
  /** In order from the star: the corpus ids run planet-b .. planet-h. */
  readonly planets: readonly ThreadPlanet[];
  /** The sources the thread's records cite. */
  readonly cited: readonly ThreadSource[];
  /** The other sources the corpus holds in the same domain. */
  readonly others: readonly ThreadSource[];
}

const CATALOG = "Source catalog";

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`public corpus has no ${what}`);
  return value;
}

export function readResearchThread(corpus: PublicCorpus): ResearchThread {
  const byId = new Map(corpus.nodes.map((n) => [n.id, n]));
  const star = need(byId.get("star"), "TRAPPIST-1 star record");
  const zone = need(byId.get("hz"), "habitable zone record");
  const inZone = new Set(corpus.edges.filter((e) => e.b === zone.id && e.relation === "located in").map((e) => e.a));
  const planets = corpus.nodes
    .filter((n) => n.kind === "Entity" && n.id.startsWith("planet-"))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((n) => ({ id: n.id, label: n.label, inZone: inZone.has(n.id), status: n.status }));
  if (planets.length === 0) throw new Error("public corpus has no planet records for the star");

  const source = (node: CorpusNode): ThreadSource => {
    const [label, kind, href, note] = need(corpus.sources[node.id], `source entry for ${node.id}`);
    return { id: node.id, kind, label, note, href, catalog: kind === CATALOG };
  };
  const citedIds = new Set([star.source, ...planets.map((p) => need(byId.get(p.id), p.id).source)]);
  const sources = corpus.nodes.filter((n) => n.kind === "Source" && n.domain === star.domain);
  return {
    star,
    zone,
    planets,
    cited: sources.filter((n) => citedIds.has(n.id)).map(source),
    others: sources.filter((n) => !citedIds.has(n.id)).map(source),
  };
}

/** "current" -> "Current". The corpus states a record's status; the page only capitalises it. */
export const statusLabel = (status: string): string => status.charAt(0).toUpperCase() + status.slice(1);
