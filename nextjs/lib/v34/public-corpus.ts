/*
  The public reference corpus behind the home hero and /world: 567 records and 1,513 explicit
  relationships over 31 public sources, served as a hash-addressed file under public/v34/.

  SERVER-ONLY. This module reads the file with `fs`; a client component must never import it (the
  island receives PUBLIC_CORPUS_PATH and PUBLIC_CORPUS_SRI as props). No `server-only` package is
  installed here, so the boundary is held by lib/v34/public-corpus.test.ts instead.

  The file is the text of the `<script id="corpus">` element of the V34 route preview, byte for
  byte. It is never edited, reordered or pruned: a different byte is a different corpus and gets a
  new name and a new hash. Every count below is computed from the data.
*/
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idsDigestInput, KIND_PLURAL, kindCounts, layoutWorld } from "./world-geometry";
import type { WorldCorpus, WorldKind } from "./world-geometry";

export type PublicCorpus = WorldCorpus & { layout: unknown };

export const PUBLIC_CORPUS_SHA256 = "d630a531e46060a75fb942965afa6c8600b7f1ee03668b78297473576d2c125e";
export const PUBLIC_CORPUS_BYTES = 275240;
export const PUBLIC_CORPUS_PATH = `/v34/corpus-${PUBLIC_CORPUS_SHA256.slice(0, 12)}.json`;
/** Subresource-integrity token for `fetch(..., { integrity })`. */
export const PUBLIC_CORPUS_SRI = `sha256-${Buffer.from(PUBLIC_CORPUS_SHA256, "hex").toString("base64")}`;

let cached: { dir: string; corpus: PublicCorpus } | null = null;

/** Reads and verifies the corpus. A hash mismatch throws, which fails the build rather than publishing a different corpus. */
export function readPublicCorpus(publicDir: string = join(process.cwd(), "public")): PublicCorpus {
  if (cached && cached.dir === publicDir) return cached.corpus;
  const bytes = readFileSync(join(publicDir, PUBLIC_CORPUS_PATH.replace(/^\//, "")));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== PUBLIC_CORPUS_SHA256) throw new Error(`public corpus hash mismatch: expected ${PUBLIC_CORPUS_SHA256}, read ${sha}`);
  const parsed = JSON.parse(bytes.toString("utf8")) as PublicCorpus;
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || typeof parsed.sources !== "object" || parsed.sources === null) {
    throw new Error("public corpus has an unexpected shape");
  }
  cached = { dir: publicDir, corpus: parsed };
  return parsed;
}

export type PublicCorpusStats = {
  records: number;
  relations: number;
  relationTypes: number;
  sources: { total: number; loaded: number; referenceOnly: number };
  /** In layer order, 1..5. */
  layers: { layer: number; kind: WorldKind; plural: string; count: number }[];
  /** Largest first, ties by name. */
  domains: { domain: string; count: number }[];
  statuses: { status: string; count: number }[];
  /** Records whose id is a NIST OSCAL control (`control-*`). */
  controlRecords: number;
};

function tally(values: readonly string[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

/** Every figure is derived from the data. The documented numbers live in the tests as expected values only. */
export function PUBLIC_CORPUS_STATS(corpus: PublicCorpus = readPublicCorpus()): PublicCorpusStats {
  const sources = Object.values(corpus.sources);
  const referenceOnly = sources.filter((s) => s[1] === "Source catalog").length;
  return {
    records: corpus.nodes.length,
    relations: corpus.edges.length,
    relationTypes: new Set(corpus.edges.map((e) => e.relation)).size,
    sources: { total: sources.length, loaded: sources.length - referenceOnly, referenceOnly },
    layers: kindCounts(corpus).map((k) => ({ layer: k.layer, kind: k.kind, plural: KIND_PLURAL[k.kind], count: k.count })),
    domains: tally(corpus.nodes.map((n) => n.domain)).map((t) => ({ domain: t.key, count: t.count })),
    statuses: tally(corpus.nodes.map((n) => n.status)).map((t) => ({ status: t.key, count: t.count })),
    controlRecords: corpus.nodes.filter((n) => n.id.startsWith("control-")).length,
  };
}

/** SHA-256 hex of the ids/edges digest input of the Layers layout: what the static SVG draws, and what every live mode must reproduce. */
export function publicCorpusIdsSha256(corpus: PublicCorpus = readPublicCorpus()): string {
  return createHash("sha256").update(idsDigestInput(layoutWorld(corpus, "layers"))).digest("hex");
}
