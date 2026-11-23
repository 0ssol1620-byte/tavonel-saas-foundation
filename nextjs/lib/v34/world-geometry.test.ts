import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/v34/world-layers.svg/route";
import { publicCorpusIdsSha256, readPublicCorpus } from "./public-corpus";
import {
  buildMesh,
  DEFAULT_CAMERA,
  describe as describeRecord,
  describeOverview,
  fnv1a,
  idsDigest,
  idsDigestInput,
  incidentRelationCount,
  KIND_COLORS,
  layoutWorld,
  PICK_RADIUS_PX,
  pick,
  projectLayout,
  projectStatic,
  recordSource,
  relatedIds,
  renderStaticSvg,
  WORLD_KINDS,
} from "./world-geometry";
import type { WorldCorpus, WorldMode } from "./world-geometry";

const corpus = readPublicCorpus();
const modes: WorldMode[] = ["layers", "world"];

describe("layoutWorld", () => {
  it("is deterministic: the same corpus gives the same coordinates", () => {
    for (const mode of modes) expect(layoutWorld(corpus, mode)).toEqual(layoutWorld(corpus, mode));
  });

  it("seeds placement by record identity, not by order", () => {
    const reversed: WorldCorpus = { ...corpus, nodes: [...corpus.nodes].reverse() };
    const a = new Map(layoutWorld(corpus, "world").nodes.map((n) => [n.id, n]));
    const b = new Map(layoutWorld(reversed, "world").nodes.map((n) => [n.id, n]));
    // World mode depends only on the id; Layers mode also depends on a record's index within its layer.
    for (const [id, n] of a) expect(b.get(id)).toEqual(n);
  });

  it("produces finite coordinates for every record in both modes, and covers all 567", () => {
    for (const mode of modes) {
      const layout = layoutWorld(corpus, mode);
      expect(layout.nodes).toHaveLength(567);
      expect(layout.edges).toHaveLength(1513);
      expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(567);
      for (const n of layout.nodes) {
        expect([n.x, n.y, n.z, n.r].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("puts the five kinds on five layers, Source through Change", () => {
    const layout = layoutWorld(corpus, "layers");
    for (const n of layout.nodes) expect(n.layer).toBe(WORLD_KINDS.indexOf(n.kind) + 1);
    const meanX = (kind: string) => {
      const xs = layout.nodes.filter((n) => n.kind === kind).map((n) => n.x);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    const means = WORLD_KINDS.map(meanX);
    expect([...means].sort((p, q) => p - q)).toEqual(means);
  });

  it("matches the target's FNV-1a on known values", () => {
    expect(fnv1a("")).toBeCloseTo(2166136261 / 4294967296, 12);
    expect(fnv1a("a")).toBe(((Math.imul(2166136261 ^ 97, 16777619)) >>> 0) / 4294967296);
    expect(fnv1a("x")).toBeGreaterThanOrEqual(0);
    expect(fnv1a("x")).toBeLessThan(1);
  });

  it("refuses an unknown kind and a dangling relationship instead of dropping them", () => {
    const first = corpus.nodes[0]!;
    expect(() => layoutWorld({ ...corpus, nodes: [{ ...first, kind: "Mystery" }] })).toThrow(/unknown record kind/);
    expect(() => layoutWorld({ ...corpus, edges: [{ a: first.id, b: "nope", relation: "x" }] })).toThrow(/not in the corpus/);
  });
});

describe("projection and picking", () => {
  const layout = layoutWorld(corpus, "layers");

  it("projects every record at the default camera in both modes", () => {
    for (const mode of modes) {
      const view = projectStatic(layoutWorld(corpus, mode));
      expect(view.nodes).toHaveLength(567);
      expect(view.edges).toHaveLength(1513);
      for (const n of view.nodes) {
        expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.depth)).toBe(true);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(view.width);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeLessThanOrEqual(view.height);
      }
    }
    expect(projectStatic(layout).planes).toHaveLength(5);
    expect(projectStatic(layoutWorld(corpus, "world")).planes).toHaveLength(0);
  });

  it("projectStatic and projectLayout agree for the same camera and size", () => {
    expect(projectStatic(layout).nodes).toEqual(projectLayout(layout, DEFAULT_CAMERA, 900, 620));
  });

  it("returns the nearest record within the radius, and null outside it", () => {
    const nodes = projectLayout(layout, DEFAULT_CAMERA, 900, 620);
    const target = nodes[300]!;
    expect(pick(nodes, target.x, target.y)).toBe(target.id);
    // Slightly off, still the nearest.
    const near = pick(nodes, target.x + 2, target.y - 1);
    const nearest = [...nodes].sort((p, q) => Math.hypot(p.x - target.x - 2, p.y - target.y + 1) - Math.hypot(q.x - target.x - 2, q.y - target.y + 1))[0]!;
    expect(near).toBe(nearest.id);
    expect(pick(nodes, -500, -500)).toBeNull();
    expect(pick(nodes, target.x + PICK_RADIUS_PX * 4, target.y + PICK_RADIUS_PX * 4, 1)).toBeNull();
  });

  it("honours the radius as an inclusive bound and prefers the record nearer the camera on a tie", () => {
    const pts = [
      { id: "far", x: 10, y: 0, depth: 0.9 },
      { id: "close", x: 10, y: 0, depth: 0.2 },
    ];
    expect(pick(pts, 0, 0, 10)).toBe("close");
    expect(pick(pts, 0, 0, 9.99)).toBeNull();
    expect(pick([], 0, 0)).toBeNull();
  });
});

describe("digest", () => {
  it("is stable across calls and modes, and independent of record order", () => {
    const a = idsDigestInput(layoutWorld(corpus, "layers"));
    expect(a).toBe(idsDigestInput(layoutWorld(corpus, "layers")));
    expect(a).toBe(idsDigestInput(layoutWorld(corpus, "world")));
    const shuffled: WorldCorpus = { ...corpus, nodes: [...corpus.nodes].reverse(), edges: [...corpus.edges].reverse() };
    expect(idsDigestInput(layoutWorld(shuffled, "layers"))).toBe(a);
  });

  it("lists every id and every relationship once", () => {
    const [ids, edges] = idsDigestInput(layoutWorld(corpus)).split("\n\n");
    expect(ids!.split("\n")).toHaveLength(567);
    expect(edges!.split("\n")).toHaveLength(1513);
  });

  it("changes when a relationship changes", () => {
    const changed: WorldCorpus = { ...corpus, edges: corpus.edges.slice(1) };
    expect(idsDigestInput(layoutWorld(changed))).not.toBe(idsDigestInput(layoutWorld(corpus)));
  });

  it("is the same in the browser path (crypto.subtle) and the server path (node:crypto)", async () => {
    const layout = layoutWorld(corpus);
    expect(await idsDigest(layout)).toBe(publicCorpusIdsSha256(corpus));
    expect(await idsDigest(layout)).toBe(createHash("sha256").update(idsDigestInput(layout)).digest("hex"));
  });
});

describe("mesh", () => {
  const layout = layoutWorld(corpus, "layers");

  it("has one vertex per record, two per relationship, and planes in Layers mode only", () => {
    const mesh = buildMesh(layout, null);
    expect(mesh.nodes.length / 8).toBe(567);
    expect(mesh.edges.length / 16).toBe(1513);
    expect(mesh.planes.length / 8).toBe(5 * 24);
    expect(buildMesh(layoutWorld(corpus, "world"), null).planes).toHaveLength(0);
    expect([...mesh.nodes, ...mesh.edges, ...mesh.planes].every(Number.isFinite)).toBe(true);
  });

  it("dims everything outside the focus and its neighbours", () => {
    const focus = "star";
    const related = relatedIds(layout, focus);
    expect(related.has(focus)).toBe(true);
    expect(related.size).toBe(1 + new Set(corpus.edges.filter((e) => e.a === focus || e.b === focus).flatMap((e) => [e.a, e.b]).filter((id) => id !== focus)).size);
    const mesh = buildMesh(layout, focus);
    layout.nodes.forEach((n, i) => {
      expect(mesh.nodes[i * 8 + 6]).toBeCloseTo(related.has(n.id) ? 0.94 : 0.15, 5);
    });
    const focused = layout.nodes.findIndex((n) => n.id === focus);
    expect(mesh.nodes[focused * 8 + 7]).toBe(12);
  });
});

describe("accessible text", () => {
  it("describes a record with its kind, domain, relationship count, source and note", () => {
    const node = corpus.nodes.find((n) => n.id === "star")!;
    const text = describeRecord(node, corpus);
    expect(text).toContain("TRAPPIST-1.");
    expect(text).toContain("Entity record in Science");
    expect(text).toContain(`${incidentRelationCount(corpus, "star")} relationships`);
    expect(text).toContain(`Source: ${corpus.sources[node.source]![0]}`);
    expect(text).not.toMatch(/\.\./);
  });

  it("links only to an https source", () => {
    const node = corpus.nodes.find((n) => n.id === "star")!;
    expect(recordSource(corpus, node)?.url).toMatch(/^https:\/\//);
    expect(recordSource({ ...corpus, sources: { [node.source]: ["t", "d", "http://x", "k"] } }, node)).toBeNull();
  });

  it("states the overview from the data", () => {
    expect(describeOverview(corpus, "layers")).toBe("567 records · 1,513 relationships · Grouped by record type of the public reference corpus.");
  });
});

describe("static SVG", () => {
  it("renders every record and relationship, with title and description", () => {
    const svg = renderStaticSvg(corpus, { idsSha: "x" });
    expect(svg.match(/<circle /g)).toHaveLength(567);
    expect(svg.match(/<line /g)).toHaveLength(1513);
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
    expect(svg).toContain('viewBox="0 0 900 620"');
    for (const color of Object.values(KIND_COLORS)) expect(svg).toContain(color);
  });

  it("is served by the route handler with the corpus's own ids and relationships and the same digest", async () => {
    const response = GET(new Request("http://localhost/v34/world-layers.svg"));
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    const svg = await response.text();
    const ids = [...svg.matchAll(/<circle [^>]*data-id="([^"]*)"/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(567);
    expect(new Set(ids)).toEqual(new Set(corpus.nodes.map((n) => n.id)));
    const lines = [...svg.matchAll(/<line [^>]*data-a="([^"]*)" data-b="([^"]*)"/g)].map((m) => [m[1]!, m[2]!] as const);
    expect(lines).toHaveLength(1513);
    // Digest recomputed from what the SVG draws: relation names come from the corpus by endpoint pair.
    const relationOf = new Map<string, string[]>();
    for (const e of corpus.edges) relationOf.set(`${e.a}|${e.b}`, [...(relationOf.get(`${e.a}|${e.b}`) ?? []), e.relation]);
    const drawn = new Set(lines.map(([a, b]) => `${a}|${b}`));
    expect(drawn).toEqual(new Set(relationOf.keys()));
    expect(svg).toContain(`data-ids-sha="${publicCorpusIdsSha256(corpus)}"`);
    expect(svg).toContain('data-node-count="567"');
    expect(svg).toContain('data-edge-count="1513"');
  });
});

/*
  WO-CI-1: `next start` does not compress app-route responses, so the home LCP image left the server at
  ~196 KB. The handler negotiates gzip itself. Every case decodes to the exact bytes the renderer draws.
*/
describe("static SVG transfer encoding", () => {
  const expected = Buffer.from(renderStaticSvg(corpus, { idsSha: publicCorpusIdsSha256(corpus) }), "utf8");

  async function fetchWith(acceptEncoding: string | null) {
    const headers = new Headers();
    if (acceptEncoding !== null) headers.set("accept-encoding", acceptEncoding);
    const response = GET(new Request("http://localhost/v34/world-layers.svg", { headers }));
    const sent = Buffer.from(await response.arrayBuffer());
    const encoding = response.headers.get("content-encoding");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("s-maxage=31536000");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("content-length")).toBe(String(sent.length));
    expect(encoding === null || encoding === "gzip").toBe(true);
    const decoded = encoding === "gzip" ? gunzipSync(sent) : sent;
    expect(decoded.equals(expected)).toBe(true);
    return { encoding, sent };
  }

  it.each([["gzip"], ["gzip, deflate, br"], ["GZIP"], ["br;q=1.0, gzip;q=0.8"], ["gzip;q=1"], ["gzip;Q=0.001"]])("compresses for %j", async (header) => {
    const { encoding, sent } = await fetchWith(header);
    expect(encoding).toBe("gzip");
    expect(sent.length).toBeLessThan(expected.length / 4);
  });

  it.each([[null], [""], ["gzip;q=0"], ["gzip;q=0.000"], ["identity"], ["br"], ["deflate"], ["*"], ["*;q=1, identity;q=0"], ["xgzip"], ["gzipx"], ["gzip;q=abc"], ["gzip;q=1.5"], ["gzip;q="], ["gzip;q=0, gzip"], ["br, gzip;q=0"]])(
    "sends identity for %j",
    async (header) => {
      const { encoding } = await fetchWith(header);
      expect(encoding).toBeNull();
    },
  );

  it("answers every Accept-Encoding header it can be sent with a decodable body and true headers", async () => {
    // Deterministic fuzz over the header grammar and its malformed neighbours (mulberry32, fixed seed).
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const codings = ["gzip", "GZip", "x-gzip", "br", "deflate", "identity", "*", "compress", "zstd", "", " ", "gzip ", "g zip", "ü"];
    const params = ["", ";q=0", ";q=1", ";q=0.5", ";q=0.000", ";q=1.000", ";q=1.001", ";q=-1", ";q=NaN", ";q=", ";q", "; q = 0.3", ";level=1", ";;", ";q=0.5;q=0"];
    const seps = [",", ", ", " ,", ",,", ";", "\t,"];
    for (let i = 0; i < 400; i += 1) {
      const parts = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(codings) + pick(params));
      const header = parts.map((p, j) => (j === 0 ? p : pick(seps) + p)).join("");
      const { encoding } = await fetchWith(header);
      if (encoding === "gzip") expect(header.toLowerCase()).toContain("gzip");
      if (!/gzip/i.test(header)) expect(encoding).toBeNull();
    }
  });
});
