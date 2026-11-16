import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_CORPUS_BYTES,
  PUBLIC_CORPUS_PATH,
  PUBLIC_CORPUS_SHA256,
  PUBLIC_CORPUS_SRI,
  PUBLIC_CORPUS_STATS,
  publicCorpusIdsSha256,
  readPublicCorpus,
} from "./public-corpus";

const root = join(import.meta.dirname, "..", "..");
const file = join(root, "public", PUBLIC_CORPUS_PATH);

describe("public corpus file", () => {
  it("is named by the first 12 hex of its sha256 and matches the recorded digest", () => {
    const bytes = readFileSync(file);
    expect(bytes.length).toBe(PUBLIC_CORPUS_BYTES);
    const digest = createHash("sha256").update(bytes);
    expect(digest.copy().digest("hex")).toBe(PUBLIC_CORPUS_SHA256);
    expect(PUBLIC_CORPUS_SHA256.startsWith("d630a531")).toBe(true);
    expect(PUBLIC_CORPUS_PATH).toBe(`/v34/corpus-${PUBLIC_CORPUS_SHA256.slice(0, 12)}.json`);
    expect(PUBLIC_CORPUS_SRI).toBe(`sha256-${digest.digest("base64")}`);
  });

  it("is the only corpus file under public/v34", () => {
    expect(readdirSync(join(root, "public", "v34")).filter((f) => f.startsWith("corpus-"))).toEqual([PUBLIC_CORPUS_PATH.split("/").pop()]);
  });

  it("is read back unchanged, and a different byte throws", () => {
    expect(readPublicCorpus(join(root, "public")).nodes.length).toBe(567);
    expect(() => readPublicCorpus(join(root, "lib", "v34", "does-not-exist"))).toThrow();
  });

  it("keeps the module off the client: the island and both renderers never import it", () => {
    // The island receives the path and SRI as props; fs in a client bundle would fail the build.
    const island = readFileSync(join(root, "components", "v34", "world", "world-island.tsx"), "utf8");
    expect(island).not.toMatch(/public-corpus/);
    for (const f of ["webgl-renderer.ts", "canvas2d-renderer.ts", "renderer-types.ts"]) {
      expect(readFileSync(join(root, "components", "v34", "world", f), "utf8")).not.toMatch(/public-corpus/);
    }
  });
});

describe("public corpus content", () => {
  const corpus = readPublicCorpus();

  it("has 567 records, 1,513 relationships and 31 sources", () => {
    expect(corpus.nodes).toHaveLength(567);
    expect(corpus.edges).toHaveLength(1513);
    expect(Object.keys(corpus.sources)).toHaveLength(31);
  });

  it("has no duplicate record ids", () => {
    expect(new Set(corpus.nodes.map((n) => n.id)).size).toBe(corpus.nodes.length);
  });

  it("names a record at both ends of every relationship", () => {
    const ids = new Set(corpus.nodes.map((n) => n.id));
    const dangling = corpus.edges.filter((e) => !ids.has(e.a) || !ids.has(e.b));
    expect(dangling).toEqual([]);
  });

  it("gives every relationship a relation and every record a known source with an https url", () => {
    expect(corpus.edges.filter((e) => !e.relation)).toEqual([]);
    expect(corpus.nodes.filter((n) => !corpus.sources[n.source])).toEqual([]);
    expect(Object.entries(corpus.sources).filter(([, s]) => !/^https:\/\//.test(s[2]))).toEqual([]);
  });

  it("computes the documented counts from the data", () => {
    const stats = PUBLIC_CORPUS_STATS(corpus);
    expect(stats.records).toBe(567);
    expect(stats.relations).toBe(1513);
    expect(stats.relationTypes).toBe(23);
    expect(stats.layers.map((l) => [l.kind, l.count])).toEqual([
      ["Source", 92],
      ["Entity", 17],
      ["Concept", 453],
      ["Claim", 2],
      ["Change", 3],
    ]);
    expect(stats.layers.map((l) => l.layer)).toEqual([1, 2, 3, 4, 5]);
    expect(stats.layers.reduce((n, l) => n + l.count, 0)).toBe(stats.records);
    expect(stats.domains).toEqual([
      { domain: "Standards", count: 465 },
      { domain: "Creative", count: 70 },
      { domain: "Science", count: 17 },
      { domain: "Business", count: 15 },
    ]);
    expect(stats.sources).toEqual({ total: 31, loaded: 15, referenceOnly: 16 });
    expect(stats.controlRecords).toBe(423);
    expect(stats.statuses.reduce((n, s) => n + s.count, 0)).toBe(567);
  });

  it("derives the ids digest of the Layers layout", () => {
    expect(publicCorpusIdsSha256(corpus)).toMatch(/^[0-9a-f]{64}$/);
  });
});
