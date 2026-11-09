import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { DesktopPrimaryNav, NavSections } from "@/components/public-site-chrome";
import { navCurrent } from "@/components/site-nav/desktop-primary-nav";
import { exploreSampleDocuments } from "./explore-sample";
import {
  CUSTOMER_NAV,
  customerNavCurrent,
  customerNavOwns,
  EXPLORE_CTA,
  FOOTER_GROUPS,
  FOOTER_LEGAL_ROW,
  HEADER_NAV,
  NAV_GROUPS,
  NAV_PENDING_HREFS,
  NAV_PRICING,
  PRIMARY_NAV,
  RESOURCE_LINKS,
  navGroupFor,
  navHrefs,
  navSectionForPath,
  KO_CHROME,
  KO_NAV_PANELS,
  navAlsoOwns,
} from "./site-navigation";

// The bar items read the route; the rendered-panel checks below are made from /docs/mcp.
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/mcp" }));

/*
  The menu model, checked where it is cheapest to check.

  Every failure this file catches is silent in the browser. A panel link to a route that does not
  exist renders as a perfectly ordinary link and 404s only for the reader who follows it; a group
  with no hub looks complete until someone wants "all of them"; a Resources panel written by hand
  beside the hub's own list drifts one label at a time; and `aria-current` derived from a mapping
  that has quietly stopped covering a path just stops saying where you are. None of them fails a
  build, and none of them shows up in a screenshot.

  What it deliberately does not check is presentation. Whether the panel opens on hover, returns
  focus on Escape and closes when the pointer leaves is behaviour in a browser, and it is asserted
  in `e2e/site-nav.spec.ts` against a production build. What the server renders -- which items
  carry a panel, and what is in it -- is pinned here, under "the rendered panels".
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
const SITEMAP_PATHS = new Set(sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/$/, "") || "/"));
const panelItems = NAV_GROUPS.flatMap((group) => [
  ...group.columns.flatMap((column) => column.items),
  ...(group.featured ? [group.featured] : []),
]);

describe("the global menu's destinations", () => {
  /*
    NAV PANELS, 2026-11-09. The groups hang from the bar that exists, not from a bar of their own.

    Each group's hub is a bar item's href and its label is that item's label, so the header can find
    a panel by the item it renders (`navGroupFor`) and never draws a second, different bar. How it
    works and Pricing carry no group: each is one page that answers its own question.
  */
  it("hangs a panel from Product, Resources and Docs, and none from How it works or Pricing", () => {
    expect(HEADER_NAV.map((item) => navGroupFor(item.href)?.label ?? null)).toEqual(["Product", null, "Resources", "Docs"]);
    expect(NAV_GROUPS).toHaveLength(3);
    for (const group of NAV_GROUPS) expect(HEADER_NAV).toContainEqual({ href: group.overviewHref, label: group.label });
    expect(navGroupFor("/pricing")).toBeUndefined();
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
    expect(navHrefs().filter((href) => href.startsWith("/cookbooks/"))).toEqual([]);
  });

  /*
    BA-039's other half: the flat inventory and the footer point at the section too.

    `NAV_PENDING_HREFS` was emptied and the panels were repointed when the hub landed, but the two
    lists that are not the panel kept `/solutions/ai-ready-knowledge` -- so the footer's
    "Solutions" was one workflow wearing the section's name on every page of the site. This is the
    assertion that fails if either list drifts back to a detail page.
  */
  it("sends every link labelled Solutions to the hub, not to one of its five pages", () => {
    for (const list of [PRIMARY_NAV, FOOTER_GROUPS.flatMap((group) => group.links)]) {
      const solutions = list.filter((link) => link.label === "Solutions");
      expect(solutions, "a list labelled Solutions with no Solutions link").not.toHaveLength(0);
      for (const link of solutions) expect(link.href).toBe("/solutions");
    }
  });

  /*
    BA-244: the panel's last row names a real corpus, and these are its real numbers.

    The Product panel had two columns of names in a full-width sheet with the right half empty,
    and the honest thing to put in that space is what is behind the link. Which makes it a
    numerical claim, so it is recomputed here from the committed sample rather than trusted --
    every figure gets a receipt, and this one's receipt is the corpus itself.
  */
  it("states the public sample's corpus in the figures the sample actually has", () => {
    const featured = NAV_GROUPS.find((group) => group.section === "product")?.featured;
    expect(featured?.href).toBe(EXPLORE_CTA.href);
    const regions = exploreSampleDocuments.reduce((total, document) => total + document.regionCount, 0);
    expect(featured?.description, "the corpus line is missing").toBeDefined();
    expect(featured!.description).toBe(
      `Apple SEC corpus · ${exploreSampleDocuments.length} filings · ${regions.toLocaleString("en-US")} regions`,
    );
  });

  /*
    BA-250: the footer's last row, and the two things it may not contain.

    The entity and the jurisdiction are the founder's to confirm (contract §2), and a footer line
    naming a party this deployment cannot read would be the invention the brief bars. The empty
    slot is asserted empty so that filling it is a deliberate act by the lane that owns the
    operator record, and not something that arrives with an unrelated edit.
  */
  /*
    chrome-14 / D36. One language per footer.

    Korean group headings over 24 English link labels reads as an unfinished translation. Every
    destination the footer lists carries a Korean label, and the table may not name a route the
    footer does not list -- which is what keys-by-href buys.
  */
  it("gives every footer destination a Korean label on /ko", () => {
    const hrefs = FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    for (const href of hrefs) expect(KO_CHROME.footerLinks[href], href).toBeTruthy();
    expect(Object.keys(KO_CHROME.footerLinks).sort()).toEqual([...hrefs].sort());
    expect(read("../components/public-site-chrome.tsx"), "and the footer renders them")
      .toContain("korean ? KO_CHROME.footerLinks[link.href] ?? link.label : link.label");
  });

  it("closes the footer with the copyright and the security inbox, and no language switch", () => {
    expect(FOOTER_LEGAL_ROW.copyright).toBe("© 2026 TAVONEL");
    /* Founder decision 2026-11-09: global-only presentation. The switch to /ko is gone, and /ko redirects. */
    expect(read("../components/public-site-chrome.tsx"), "the footer renders no language switch").not.toContain("한국어");
    expect(SITEMAP_PATHS.has("/ko"), "the Korean entry is no longer a published route").toBe(false);
    expect(FOOTER_LEGAL_ROW.security).toBe("security@tavonel.com");
    expect(Object.keys(FOOTER_LEGAL_ROW).sort()).toEqual(["copyright", "security"]);
    const chrome = read("../components/public-site-chrome.tsx");
    expect(chrome, "the row is rendered, not just declared").toContain("FOOTER_LEGAL_ROW.copyright");
    for (const invented of ["Co., Ltd", "Inc.", "Republic of Korea", "governed by the laws"]) {
      expect(chrome, `the footer may not name ${invented} until the founder confirms it`).not.toContain(invented);
    }
  });
});

/*
  Landing V2, 2026-09-19 (blueprint §8, contract D2). The public destinations a reader actually sees.

  Everything above this describes `NAV_GROUPS`, the 2026-09-11 IA model, which hangs from this
  bar again since NAV PANELS (2026-11-09). `CUSTOMER_NAV` is still the array both chromes map
  over, and until now it was checked only by
  `lib/one-path-contract.test.ts`'s equality assertion, which cannot catch the two failures that
  are silent in a browser: a bar link to a route the site does not publish, and a /ko header with
  an English label in it because the Korean table was not extended with the bar.
*/
describe("the production customer destinations in the bar", () => {
  it("shows Product, How it works, Resources, Docs and Pricing in order", () => {
    expect(CUSTOMER_NAV).toEqual([
      { href: "/product", label: "Product" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/resources", label: "Resources" },
      { href: "/docs", label: "Docs" },
      { href: "/pricing", label: "Pricing" },
    ]);
  });

  it("keeps the public sample CTA and developer footer destination reachable", () => {
    expect(EXPLORE_CTA.href).toBe("/explore");
    expect(SITEMAP_PATHS.has(EXPLORE_CTA.href)).toBe(true);
    const footerHrefs = FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    expect(footerHrefs).toContain("/developers");
    expect(SITEMAP_PATHS.has("/developers")).toBe(true);
  });

  it("offers no link the site cannot answer", () => {
    for (const item of CUSTOMER_NAV) {
      expect(SITEMAP_PATHS.has(item.href), `${item.href} is not in app/sitemap.ts`).toBe(true);
    }
  });

  it("gives every one of them a Korean label, and names no route it does not carry", () => {
    const hrefs = CUSTOMER_NAV.map((item) => item.href);
    for (const href of hrefs) expect(KO_CHROME.nav[href], href).toBeTruthy();
    expect(Object.keys(KO_CHROME.nav).sort()).toEqual([...hrefs].sort());
  });

  it("writes each label once, and points each destination at one item", () => {
    expect(new Set(CUSTOMER_NAV.map((item) => item.label)).size).toBe(CUSTOMER_NAV.length);
    expect(new Set(CUSTOMER_NAV.map((item) => item.href)).size).toBe(CUSTOMER_NAV.length);
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
      // EN-0: the cookbooks index is a hub entry, beside the documentation it complements.
      "/cookbooks",
      "/api",
      "/evidence",
      "/reproducibility",
    ]);
  });
});

describe("the Solutions column of the Product panel", () => {
  const page = read("../app/solutions/[slug]/page.tsx");
  const column = NAV_GROUPS.find((group) => group.section === "product")?.columns.find(
    (candidate) => candidate.title === "Solutions by workflow",
  );
  // The column ends on the hub, which the Solutions panel carried as its featured link.
  const items = column?.items.filter((item) => item.href !== "/solutions") ?? [];

  it("ends on the Solutions hub", () => {
    expect(column?.items.at(-1)).toEqual({ href: "/solutions", label: "All solutions" });
  });

  it("lists every solution the page publishes and invents none", () => {
    const published = [...page.matchAll(/^ {2}"([a-z-]+)": \{$/gm)].map((match) => match[1]);
    expect(published.length, "SOLUTIONS keys were not found -- the regex is out of date").toBe(5);
    expect([...items.map((item) => item.href.replace("/solutions/", ""))].sort()).toEqual([...published].sort());
  });

  it("takes each label and audience from the page instead of writing new ones", () => {
    for (const item of items) {
      // type-02: the kicker is sentence case now, so the coupling is the label verbatim rather
      // than its upper-cased form. Same intent: the menu and the page say the same words.
      expect(page, `no eyebrow matches the menu label "${item.label}"`).toContain(
        `eyebrow: "${item.label}"`,
      );
      expect(page, `no audience matches the menu description for ${item.href}`).toContain(
        `audience: "${item.description}"`,
      );
    }
  });
});

/*
  NAV PANELS, 2026-11-09. One language per panel, the footer's rule (chrome-14 / D36).

  The /ko header renders the panels too, so every column title, link and audience line they carry
  has a Korean spelling, and the table names nothing the panels do not carry. The corpus line is a
  number in two languages: the Korean one is held to the same figures as the English one.
*/
describe("the panels in Korean", () => {
  const items = NAV_GROUPS.flatMap((group) => [
    ...group.columns.flatMap((column) => column.items),
    ...(group.featured ? [group.featured] : []),
  ]);

  it("translates every column, link and description, and nothing else", () => {
    const titles = NAV_GROUPS.flatMap((group) => group.columns.map((column) => column.title));
    expect(Object.keys(KO_NAV_PANELS.columns).sort()).toEqual([...new Set(titles)].sort());
    expect(Object.keys(KO_NAV_PANELS.links).sort()).toEqual([...new Set(items.map((item) => item.href))].sort());
    const described = items.filter((item) => item.description).map((item) => item.href);
    expect(Object.keys(KO_NAV_PANELS.descriptions).sort()).toEqual([...new Set(described)].sort());
  });

  it("states the sample corpus with the figures the English line has", () => {
    const regions = exploreSampleDocuments.reduce((total, document) => total + document.regionCount, 0);
    expect(KO_NAV_PANELS.descriptions["/explore"]).toBe(
      `Apple SEC 코퍼스 · 공시 ${exploreSampleDocuments.length}건 · 영역 ${regions.toLocaleString("en-US")}개`,
    );
  });
});

/*
  NAV PANELS, 2026-11-09: what the server sends, before any script runs.

  A bar item that owns a group is followed by a closed disclosure button and the panel it names, and
  the panel carries every link of the group. The labels stay links to their hubs, `aria-current`
  still comes from `customerNavCurrent`, and nothing in a panel claims the current page. The sheet
  renders the same rows, so the phone gets the same groups rather than a second list.
*/
describe("the rendered panels", () => {
  const groupHrefs = (section: string) => {
    const group = NAV_GROUPS.find((candidate) => candidate.section === section)!;
    return [...group.columns.flatMap((column) => column.items), ...(group.featured ? [group.featured] : [])].map(
      (item) => item.href,
    );
  };
  const panelOf = (html: string, id: string) => {
    const start = html.indexOf(`id="${id}"`);
    expect(start, `${id} is not rendered`).toBeGreaterThan(-1);
    const next = html.indexOf("-nav-panel-", start + id.length + 4);
    return html.slice(start, next > -1 ? next : html.length);
  };
  // Every anchor with the class, in document order, attribute order aside.
  const anchors = (html: string, className: string) =>
    (html.match(/<a [^>]*>/g) ?? []).filter((tag) => tag.includes(`class="${className}"`));
  const hrefOf = (tag: string) => /href="([^"]+)"/.exec(tag)?.[1];

  it("draws the bar as four links, a closed toggle beside the three that own a group, and their panels", () => {
    const html = renderToStaticMarkup(createElement(DesktopPrimaryNav));
    const bar = anchors(html, "site-nav-direct");
    expect(bar.map(hrefOf)).toEqual(HEADER_NAV.map((item) => item.href));
    const toggles = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(toggles).toHaveLength(NAV_GROUPS.length);
    for (const group of NAV_GROUPS) {
      const toggle = toggles.find((candidate) => candidate.includes(`aria-controls="bar-nav-panel-${group.section}"`));
      expect(toggle, `${group.label} has no toggle`).toBeDefined();
      expect(toggle).toContain('aria-expanded="false"');
      expect(toggle).toContain(`aria-label="${group.label} menu"`);
      const panel = panelOf(html, `bar-nav-panel-${group.section}`);
      for (const href of groupHrefs(group.section)) expect(panel, `${group.label} panel lacks ${href}`).toContain(`href="${href}"`);
    }
    expect(html, "How it works opens nothing").not.toContain('data-hub="/how-it-works"');
    expect(bar.find((tag) => hrefOf(tag) === "/docs"), "the bar marks the section it owns").toContain('aria-current="location"');
    expect(html.match(/aria-current=/g), "and nothing else").toHaveLength(1);
    expect(html).not.toContain('role="menu"');
  });

  /*
    The script ratchet's half of this change. Home and /ko load `lib/site-navigation`'s chunk only if
    a client module they run imports it, and the two header client files were the only ones. The
    client copy of the ownership rule is therefore held to the server's on every bar href.
  */
  it("keeps the header's client files off lib/site-navigation, with the same ownership rule", () => {
    for (const file of ["../components/site-nav/desktop-primary-nav.tsx", "../components/mobile-primary-nav.tsx"]) {
      expect(read(file), `${file} imports the navigation module`).not.toMatch(/from "(?:@\/lib|\.\.?\/lib|\.)\/site-navigation"/);
    }
    const paths = ["/", "/product", "/product/", "/product/compiled-world", "/productivity", "/how-it-works", "/research",
      "/research/notes", "/benchmarks/gdp-pdf", "/changelog", "/guide", "/docs", "/docs/mcp", "/docs-old", "/sources",
      "/pricing", "/ko/pricing", "/resources", "/explore", ""];
    for (const { href } of CUSTOMER_NAV) {
      for (const path of paths) expect(navCurrent(href, navAlsoOwns(href), path), `${href} on ${path}`).toBe(customerNavCurrent(href, path));
    }
  });

  it("renders the same groups as the phone sheet's rows, in Korean on /ko", () => {
    const html = renderToStaticMarkup(createElement(NavSections, { korean: true, sheet: true }));
    expect(anchors(html, "mobile-nav-direct").map(hrefOf)).toEqual(HEADER_NAV.map((item) => item.href));
    for (const group of NAV_GROUPS) {
      const panel = panelOf(html, `sheet-nav-panel-${group.section}`);
      for (const href of groupHrefs(group.section)) {
        expect(panel).toContain(`href="${href}"`);
        expect(panel).toContain(KO_NAV_PANELS.links[href]);
      }
      expect(html).toContain(`aria-label="${KO_CHROME.nav[group.overviewHref]} ${KO_NAV_PANELS.menu}"`);
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

describe("the customer navigation's current page and section", () => {
  it.each(CUSTOMER_NAV)("marks the exact $href destination as the current page", ({ href }) => {
    expect(customerNavCurrent(href, href)).toBe("page");
    expect(customerNavCurrent(href, `${href}/`)).toBe("page");
    expect(customerNavOwns(href, href)).toBe(true);
  });

  it.each([
    ["/product/compiled-world", "/product"],
    ["/docs/mcp", "/docs"],
    ["/research", "/resources"],
    ["/research/notes", "/resources"],
    ["/evidence", "/resources"],
    ["/reproducibility", "/resources"],
    ["/benchmarks", "/resources"],
    ["/benchmarks/gdp-pdf", "/resources"],
    ["/changelog", "/resources"],
  ])("marks %s as a location within %s, with one owner", (path, owner) => {
    expect(customerNavCurrent(owner, path)).toBe("location");
    expect(customerNavCurrent(owner, `${path}/`)).toBe("location");
    expect(CUSTOMER_NAV.filter(({ href }) => customerNavOwns(href, path)).map(({ href }) => href)).toEqual([owner]);
  });

  it.each([
    "/", "/trust", "/contact", "/privacy", "/workspace",
    "/explore", "/developers", "/api", "/cookbooks", "/sources", "/integrations",
    "/knowledge-compiler", "/solutions", "/solutions/source-grounded-assistants",
    "/productivity", "/solutions-extra", "/sources-extra", "/integrations-old",
    "/knowledge-compiler-extra", "/developers-guide", "/docs-old", "/apidocs",
    "/changelog-extra", "/cookbookshelf", "/explorers", "/pricing-extra",
  ])("gives %s no false page or section owner", (path) => {
    for (const { href } of CUSTOMER_NAV) {
      expect(customerNavCurrent(href, path)).toBeUndefined();
      expect(customerNavOwns(href, path)).toBe(false);
    }
  });

  it("preserves legacy registry sections without using them as false bar owners", () => {
    expect(navSectionForPath("/docs/mcp")).toBe("developers");
    expect(customerNavCurrent("/docs", "/docs/mcp")).toBe("location");
    expect(navSectionForPath("/sources")).toBe("product");
    expect(customerNavCurrent("/product", "/sources")).toBeUndefined();
  });
});
