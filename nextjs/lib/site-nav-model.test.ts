import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import {
  NAV_GROUPS,
  NAV_PENDING_HREFS,
  NAV_PRICING,
  RESOURCE_LINKS,
  navHrefs,
  navSectionForPath,
} from "./site-navigation";

/*
  The menu model, checked where it is cheapest to check.

  Every failure this file catches is silent in the browser. A panel link to a route that does not
  exist renders as a perfectly ordinary link and 404s only for the reader who follows it; a group
  with no hub looks complete until someone wants "all of them"; a Resources panel written by hand
  beside the hub's own list drifts one label at a time; and `aria-current` derived from a mapping
  that has quietly stopped covering a path just stops saying where you are. None of them fails a
  build, and none of them shows up in a screenshot.

  What it deliberately does not check is presentation. Whether the panel opens on click, returns
  focus on Escape and closes on an outside press is behaviour in a browser, and it is asserted in
  `e2e/site-nav.spec.ts` and `e2e/launch-qa-mobile-nav.spec.ts` against a production build.
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
const SITEMAP_PATHS = new Set(sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/$/, "") || "/"));
const panelItems = NAV_GROUPS.flatMap((group) => [
  ...group.columns.flatMap((column) => column.items),
  ...(group.featured ? [group.featured] : []),
]);

describe("the global menu's destinations", () => {
  it("is five things in the bar: four groups and Pricing", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(["Product", "Solutions", "Developers", "Resources"]);
    expect(NAV_PRICING).toEqual({ href: "/pricing", label: "Pricing" });
  });

  it("offers no link the site cannot answer", () => {
    const unreachable = navHrefs().filter(
      (href) => !SITEMAP_PATHS.has(href) && !NAV_PENDING_HREFS.includes(href),
    );
    expect(unreachable, "menu destinations that are neither a published route nor declared pending").toEqual([]);
  });

  /*
    The pending list is an exception with an expiry, and the expiry has passed.

    It held `/solutions` while the hub lived on a sibling branch. Stage-B integration merged both,
    so the list is empty and the previous test above -- every menu destination is a sitemap route
    -- now carries the whole menu with no exception to hide behind. That is the tighter rule, and
    it is why emptying the list is not a loosening: the escape hatch is pinned shut, and the loop
    still fails if someone re-opens it for a page that already answers.
  */
  it("declares no pending destination, because the hub it was waiting for landed", () => {
    expect(NAV_PENDING_HREFS).toEqual([]);
    for (const href of NAV_PENDING_HREFS) {
      expect(
        () => read(`../app${href}/page.tsx`),
        `${href} exists now -- drop it from NAV_PENDING_HREFS and add it to app/sitemap.ts`,
      ).toThrow();
    }
    // The counterpart of the emptied entry: the hub answers and is advertised, both directions.
    expect(() => read("../app/solutions/page.tsx")).not.toThrow();
    expect(SITEMAP_PATHS.has("/solutions"), "/solutions is in app/sitemap.ts ROUTES").toBe(true);
    expect(navHrefs().filter((href) => href === "/solutions"), "one All solutions link").toHaveLength(1);
  });

  it("lists /explore twice and nothing else twice", () => {
    const counts = new Map<string, number>();
    for (const item of panelItems) counts.set(item.href, (counts.get(item.href) ?? 0) + 1);
    const repeated = [...counts].filter(([, count]) => count > 1).map(([href]) => href);
    // Doc 5.4 allows one guide to be linked from two panels; what it forbids is two URLs for it.
    expect(repeated).toEqual(["/explore"]);
  });

  it("gives every group a hub that is one of its own links", () => {
    for (const group of NAV_GROUPS) {
      const own = [
        ...group.columns.flatMap((column) => column.items.map((item) => item.href)),
        ...(group.featured ? [group.featured.href] : []),
      ];
      expect(own, `${group.label} has no link to its own hub ${group.overviewHref}`).toContain(group.overviewHref);
    }
  });

  it("advertises no draft route", () => {
    // A draft cookbook is not offered to a reader from the site's own menu.
    expect(navHrefs().filter((href) => href.startsWith("/cookbooks"))).toEqual([]);
  });
});

describe("the Resources panel", () => {
  const resources = NAV_GROUPS.find((group) => group.section === "resources");

  it("is read off RESOURCE_LINKS rather than written beside it", () => {
    for (const column of ["learn", "verify"] as const) {
      const expected = RESOURCE_LINKS.filter((link) => link.column === column).map(({ href, label }) => ({
        href,
        label,
      }));
      expect(expected.length, `no RESOURCE_LINKS entry is marked ${column}`).toBeGreaterThan(0);
      const rendered = resources?.columns.find((candidate) =>
        candidate.items.every((item) => expected.some((entry) => entry.href === item.href)),
      );
      expect(rendered?.items, `the ${column} column disagrees with RESOURCE_LINKS`).toEqual(expected);
    }
  });

  it("leaves the hub-only entries out of the menu", () => {
    const inPanel = resources?.columns.flatMap((column) => column.items.map((item) => item.href)) ?? [];
    for (const link of RESOURCE_LINKS) {
      if (link.column) continue;
      expect(inPanel, `${link.href} carries no column and must not be in the panel`).not.toContain(link.href);
    }
    // The four that stay on the hub only: doc 5.4's own decision, asserted so it is not undone by
    // a tag added for an unrelated reason.
    expect(RESOURCE_LINKS.filter((link) => !link.column).map((link) => link.href)).toEqual([
      "/docs",
      "/api",
      "/evidence",
      "/reproducibility",
    ]);
  });
});

describe("the Solutions panel", () => {
  const page = read("../app/solutions/[slug]/page.tsx");
  const items = NAV_GROUPS.find((group) => group.section === "solutions")?.columns[0]?.items ?? [];

  it("lists every solution the page publishes and invents none", () => {
    const published = [...page.matchAll(/^ {2}"([a-z-]+)": \{$/gm)].map((match) => match[1]);
    expect(published.length, "SOLUTIONS keys were not found -- the regex is out of date").toBe(5);
    expect([...items.map((item) => item.href.replace("/solutions/", ""))].sort()).toEqual([...published].sort());
  });

  it("takes each label and audience from the page instead of writing new ones", () => {
    for (const item of items) {
      expect(page, `no eyebrow matches the menu label "${item.label}"`).toContain(
        `eyebrow: "${item.label.toUpperCase()}"`,
      );
      expect(page, `no audience matches the menu description for ${item.href}`).toContain(
        `audience: "${item.description}"`,
      );
    }
  });
});

describe("which bar item owns the page being read", () => {
  it.each([
    ["/product", "product"],
    ["/product/compiled-world", "product"],
    ["/sources", "product"],
    ["/integrations", "product"],
    ["/trust", "product"],
    ["/security", "product"],
    ["/solutions", "solutions"],
    ["/solutions/knowledge-graph", "solutions"],
    ["/developers", "developers"],
    ["/docs", "developers"],
    ["/docs/mcp", "developers"],
    ["/api", "developers"],
    ["/resources", "resources"],
    ["/explore", "resources"],
    ["/knowledge-compiler", "resources"],
    ["/research", "resources"],
    ["/research/notes", "resources"],
    ["/benchmarks", "resources"],
    ["/changelog", "resources"],
    ["/evidence", "resources"],
    ["/reproducibility", "resources"],
    ["/pricing", "pricing"],
  ])("marks %s as %s", (path, section) => {
    expect(navSectionForPath(path)).toBe(section);
  });

  /*
    The failure path: a page the menu does not own is marked as nothing.

    This is the half that is easy to get wrong by making the mapping helpful -- returning the
    first prefix that loosely matches would put a `aria-current` on Product while the reader is
    on `/privacy`, which tells them something false about where they are.
  */
  it.each(["/", "/login", "/contact", "/privacy", "/terms", "/status", "/workspace", "/workspace/abc", "/apidocs", "/productivity", ""])(
    "marks %s as no section at all",
    (path) => {
      expect(navSectionForPath(path)).toBeNull();
    },
  );

  it("reads a trailing slash as the same page", () => {
    expect(navSectionForPath("/docs/mcp/")).toBe("developers");
    expect(navSectionForPath("/pricing/")).toBe("pricing");
  });
});
