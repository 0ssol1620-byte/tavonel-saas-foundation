import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, planAvailability } from "../billing-catalog";
import { BRAND_LINE } from "../site-navigation";
import {
  V34_HELD_PATHS,
  V34_LIVE_PATHS,
  V34_ROUTE_KEYS,
  V34_ROUTES,
  v34Route,
  v34RouteByPath,
} from "./routes";

const HELD_KEYS = [
  "autopilot", "creators", "teams", "governance", "federation", "catalog", "marketplace", "steward",
  "skills", "outcomes", "film", "trading", "realestate", "community", "journal-markets", "journal-property",
];

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("V34 route registry", () => {
  it("has 43 unique keys and paths, in key-list order", () => {
    expect(V34_ROUTES).toHaveLength(43);
    expect(new Set(V34_ROUTES.map((r) => r.key)).size).toBe(43);
    expect(new Set(V34_ROUTES.map((r) => r.path)).size).toBe(43);
    expect(V34_ROUTES.map((r) => r.key)).toEqual([...V34_ROUTE_KEYS]);
  });

  it("holds exactly the 16 decided routes and ships 27", () => {
    const held = V34_ROUTES.filter((r) => r.release === "held").map((r) => r.key);
    expect([...held].sort()).toEqual([...HELD_KEYS].sort());
    expect(V34_LIVE_PATHS).toHaveLength(27);
    expect(V34_HELD_PATHS).toHaveLength(16);
  });

  it("writes paths with a leading slash and no trailing slash", () => {
    for (const r of V34_ROUTES) {
      expect(r.path.startsWith("/"), r.key).toBe(true);
      if (r.path !== "/") expect(r.path.endsWith("/"), r.key).toBe(false);
      expect(r.canonical).toBe(`https://tavonel.com${r.path === "/" ? "" : r.path}`);
    }
  });

  it("sizes titles and descriptions, and keeps them unique", () => {
    for (const r of V34_ROUTES) {
      if (r.key === "home") {
        expect(r.title).toBe(`TAVONEL — ${BRAND_LINE.headline}`);
      } else {
        expect(r.title.length, r.title).toBeGreaterThanOrEqual(50);
        expect(r.title.length, r.title).toBeLessThanOrEqual(60);
        expect(r.title, r.key).toMatch(/ — TAVONEL$/);
      }
      expect(r.description.length, r.key).toBeGreaterThanOrEqual(120);
      expect(r.description.length, r.key).toBeLessThanOrEqual(160);
      expect(r.description, r.key).not.toContain(";");
    }
    expect(new Set(V34_ROUTES.map((r) => r.title)).size).toBe(43);
    expect(new Set(V34_ROUTES.map((r) => r.description)).size).toBe(43);
  });

  it("points every nav entry at a registered route and names five primary links", () => {
    const groups = new Set(["product", "for-you", "build-trust", "company"]);
    for (const r of V34_ROUTES.filter((x) => x.nav)) {
      expect(groups.has(r.nav!.group), r.key).toBe(true);
      expect(r.nav!.label.trim(), r.key).not.toBe("");
      expect(v34RouteByPath(r.path)?.key).toBe(r.key);
    }
    const primary = V34_ROUTES.filter((r) => r.primaryNav);
    expect(primary).toHaveLength(5);
    for (const r of primary) expect(r.release, r.key).toBe("live");
    expect(v34RouteByPath("/nowhere")).toBeUndefined();
    expect(() => v34Route("nowhere" as never)).toThrow(/unknown key/);
  });

  it("keeps internal ids, roadmap wording and plan names out of every string", () => {
    const labels = Object.values(BILLING_OFFERS).map((o) => o.label);
    // A route may carry its own name: the registry's `/personal` route is titled exactly "Personal", which is a place
    // on the site and not a plan claim. Any longer string that names a plan label is still refused.
    const routeNames = new Set(V34_ROUTES.flatMap((r) => [r.nav?.label, r.ogLabel].filter((name): name is string => Boolean(name))));
    for (const text of V34_ROUTES.flatMap(strings)) {
      expect(text).not.toMatch(/\b[DU]\d{2}\b|\bEG-?\d+\b/);
      expect(text).not.toMatch(/roadmap|coming soon|\bflip\b/i);
      expect(text).not.toMatch(/\$\d/);
      if (routeNames.has(text)) continue;
      for (const label of labels) expect(text).not.toMatch(new RegExp(`\\b${label}\\b`));
    }
  });

  it("names a plan label nowhere but as a route's own name, and the guard sees a plan name when one is written", () => {
    const labels = Object.values(BILLING_OFFERS).map((o) => o.label);
    const carriers = V34_ROUTES.flatMap(strings).filter((text) => labels.some((label) => new RegExp(`\\b${label}\\b`).test(text)));
    expect([...new Set(carriers)]).toEqual(["Personal"]);
    expect("Choose the Team plan", "the pattern is live").toMatch(new RegExp(`\\b${BILLING_OFFERS.team.label}\\b`));
  });

  it("derives sitemap and analytics from release, and leaves held routes out", () => {
    for (const r of V34_ROUTES) {
      expect(r.sitemap, r.key).toBe(r.release === "live");
      expect(r.measured, r.key).toBe(r.release === "live");
    }
    for (const path of V34_HELD_PATHS) expect(V34_LIVE_PATHS).not.toContain(path);
  });

  /*
    The dates are the commit dates of each article's source file (git log --follow), written here at
    integration, never typed in a page. This pins their shape, and that only an article whose source
    exists carries them; the article page throws when its record has none.
  */
  it("types every journal article as an Article and dates only articles that have a source", () => {
    for (const r of V34_ROUTES) {
      if (!r.path.startsWith("/journal/")) {
        expect(r.article, r.key).toBeUndefined();
        continue;
      }
      expect(r.schema, r.key).toBe("Article");
      const name = r.key.replace(/^journal-/, "");
      const source = join(import.meta.dirname, `../../components/v34/routes/${r.key}/${name}-article.tsx`);
      expect(existsSync(source), r.key).toBe(true);
      expect(r.article?.published, r.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.article?.modified, r.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.article!.published <= r.article!.modified, r.key).toBe(true);
    }
  });
});

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("V34 unshipped-capability gates", () => {
  it("holds /teams exactly while the Team plan is not purchasable", () => {
    // Catalog v2: the hold binds to the server's availability for the plan the page is about.
    expect(planAvailability("team")).not.toBe("purchasable");
    expect(v34Route("teams").release === "held").toBe(planAvailability("team") !== "purchasable");
  });

  it("keeps plan prices and plan names out of components/v34 (vacuous while absent)", () => {
    const root = join(import.meta.dirname, "../../components/v34");
    for (const path of sourceFiles(root)) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/\$29\b|\$49\b|\$99\b|\$199\b|\$799\b|\bPersonal\b|\bDeveloper\b|\bTeam\b|\bBusiness\b/);
    }
  });
});
