/**
 * Per-route SEO pass (architecture section 5). `parseSeo` and `checkSeo` are pure so the
 * self-test needs no server; `fetchSeo` and `fetchSitemapPaths` do the HTTP.
 *
 * Held routes: against a server in production mode (VERCEL_ENV=production) they must 404; against
 * the QA-mode server (V34_SHOW_HELD=1) they render, must be noindex, and must be absent from the
 * sitemap. Live routes: 200, indexable, in the sitemap.
 */

import type { APIRequestContext } from "@playwright/test";
import type { Violation } from "./v34-measure";

export type SeoFacts = {
  status: number;
  title: string | null;
  description: string | null;
  canonicals: string[];
  robots: string | null;
  jsonLd: { raw: string; value: unknown; error?: string }[];
};

export type SeoExpectation = {
  route: string;
  release: "live" | "held";
  /** "production": held 404s. "qa": held renders noindex. */
  server: "production" | "qa";
  origin?: string;
  inSitemap?: boolean;
};

const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find(v => v !== undefined) ?? null;

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function parseSeo(html: string, status: number): SeoFacts {
  const head = html;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
  const meta = (name: string) => {
    const tag = metas.find(t => attr(t, "name")?.toLowerCase() === name);
    return tag ? decode(attr(tag, "content") ?? "") : null;
  };
  const canonicals = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map(m => m[0])
    .filter(t => (attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"))
    .map(t => decode(attr(t, "href") ?? ""));
  const jsonLd = [...head.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => {
    try {
      return { raw: m[1], value: JSON.parse(m[1]) as unknown };
    } catch (error) {
      return { raw: m[1], value: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { status, title: title === undefined ? null : decode(title.trim()), description: meta("description"), canonicals, robots: meta("robots"), jsonLd };
}

export async function fetchSeo(request: APIRequestContext, route: string): Promise<SeoFacts> {
  const res = await request.get(route, { maxRedirects: 0, failOnStatusCode: false });
  return parseSeo(res.status() === 200 ? await res.text() : "", res.status());
}

export async function fetchSitemapPaths(request: APIRequestContext, origin = "https://tavonel.com"): Promise<Set<string>> {
  const res = await request.get("/sitemap.xml", { failOnStatusCode: false });
  const body = await res.text();
  const paths = new Set<string>();
  for (const m of body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) paths.add(m[1].startsWith(origin) ? m[1].slice(origin.length) || "/" : m[1]);
  return paths;
}

/** Single-route checks. Uniqueness across the set is `checkSeoUnique`. */
export function checkSeo(facts: SeoFacts, e: SeoExpectation): Violation[] {
  const out: Violation[] = [];
  const v = (detail: string) => out.push({ pass: "seo", selector: e.route, detail });
  const origin = e.origin ?? "https://tavonel.com";
  if (e.release === "held" && e.server === "production") {
    if (facts.status !== 404) v(`held route returned ${facts.status} in production mode, expected 404`);
    return out;
  }
  if (facts.status !== 200) {
    v(`status ${facts.status}, expected 200`);
    return out;
  }
  if (!facts.title) v("missing <title>");
  if (!facts.description) v("missing meta description");
  if (facts.canonicals.length !== 1) v(`${facts.canonicals.length} canonical links, expected 1`);
  else {
    const c = facts.canonicals[0];
    const expected = `${origin}${e.route === "/" ? "" : e.route}`;
    if (!/^https?:\/\//.test(c)) v(`canonical "${c}" is not absolute`);
    else if (c !== expected && !(e.route === "/" && c === `${origin}/`)) v(`canonical "${c}" != "${expected}"`);
  }
  const noindex = /noindex/i.test(facts.robots ?? "");
  if (e.release === "live" && noindex) v(`live route is noindex ("${facts.robots}")`);
  if (e.release === "held" && !noindex) v("held route renders without noindex");
  for (const block of facts.jsonLd) if (block.error) v(`JSON-LD does not parse: ${block.error}`);
  if (e.inSitemap !== undefined) {
    const should = e.release === "live";
    if (e.inSitemap !== should) v(should ? "live route missing from sitemap.xml" : "held route present in sitemap.xml");
  }
  return out;
}

/** Titles and descriptions must be unique across the set of rendered routes. */
export function checkSeoUnique(rows: { route: string; facts: SeoFacts }[]): Violation[] {
  const out: Violation[] = [];
  for (const field of ["title", "description"] as const) {
    const seen = new Map<string, string>();
    for (const { route, facts } of rows) {
      const value = facts[field];
      if (!value || facts.status !== 200) continue;
      const prior = seen.get(value);
      if (prior) out.push({ pass: "seo-unique", selector: route, detail: `${field} duplicates ${prior}: "${value.slice(0, 60)}"` });
      else seen.set(value, route);
    }
  }
  return out;
}
