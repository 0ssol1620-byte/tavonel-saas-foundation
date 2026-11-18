import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrustNext } from "@/components/trust-next";
import { EnterpriseBody } from "@/components/v34/routes/enterprise/enterprise";
import { EvidenceBody } from "@/components/v34/routes/evidence/evidence";
import { JournalBody } from "@/components/v34/routes/journal/journal";
import { PlatformBody } from "@/components/v34/routes/platform/platform";
import { ProgramBody } from "@/components/v34/routes/research-program/program";
import { ResearchBody } from "@/components/v34/routes/research/research";
import { WorldBody } from "@/components/v34/routes/world/world";
import { sampleEvidencePage } from "@/lib/evidence-regions";
import enterpriseModule from "@/components/v34/routes/enterprise/enterprise.module.css";
import journalModule from "@/components/v34/routes/journal/journal.module.css";
import platformModule from "@/components/v34/routes/platform/platform.module.css";
import researchModule from "@/components/v34/routes/research/research.module.css";
import worldModule from "@/components/v34/routes/world/world.module.css";

/*
  WO-CI-24 closing round. Two guards over the routes this work order touched.

  1. Lead decision 23: a link inside a sentence is a plain inline box; a link that must be an easy
     tap stands in its own row with the 44 px floor. The defect class is "a row link class (one
     that makes a box: a display other than inline, or a height floor) used for a link that shares
     its parent element with text", which puts a 44 px box inside a line of text. The /benchmarks
     link on /research was one; the guard reads every link of each route's server render, the
     text its parent element holds outside it, and the route sheet's rule for each class it carries.

  2. Lead decision 17 and the closing round's ruling E: TrustNext's heading level comes from the
     host, with no default for an unnamed host to fall into.
*/

const ROOT = join(import.meta.dirname, "../..");
type Sheet = { css: string; rendered: (local: string) => string | undefined };
/** A route sheet's text, and the class name its CSS module renders for a local name. */
const sheet = (route: string, module: Record<string, string>): Sheet => ({
  css: readFileSync(join(ROOT, "components/v34/routes", route, `${route}.module.css`), "utf8"),
  rendered: (local) => module[local],
});
const SHEETS = {
  research: sheet("research", researchModule),
  platform: sheet("platform", platformModule),
  journal: sheet("journal", journalModule),
  world: sheet("world", worldModule),
  enterprise: sheet("enterprise", enterpriseModule),
} as const;
/** For synthetic markup, where a class renders as its own name. */
const literal = (css: string): Sheet => ({ css, rendered: (local) => local });

/**
 * The classes of a sheet whose own rule makes a row box: a `display` other than `inline` or a
 * `min-height` / `height`. Only a rule whose selector is the bare class counts (`.x`, also inside a
 * media block); `.x:hover` or `.a .x` paint a state or a context and are not what the class is.
 */
function rowClasses(css: string): Set<string> {
  const found = new Set<string>();
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const open = chunk.lastIndexOf("{");
    if (open < 0) continue;
    const body = chunk.slice(open + 1);
    const display = body.match(/(?:^|;)\s*display\s*:\s*([^;]+)/);
    const box = (display && display[1]!.trim() !== "inline") || /(?:^|;)\s*(?:min-height|height)\s*:/.test(body);
    if (!box) continue;
    for (const selector of chunk.slice(0, open).split("{").pop()!.split(",")) {
      const bare = selector.trim().match(/^\.([\w-]+)$/);
      if (bare) found.add(bare[1]!);
    }
  }
  return found;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/* Phrasing elements: their text runs in the same lines as the text around them. */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "label", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var",
]);

type Frame = { tag: string; attrs: string; outside: string; links: { attrs: string; text: string }[]; text: string };

/**
 * Every `<a>` of a server render, with its class list and the text that shares its lines: the text
 * of its nearest non-phrasing ancestor (a p, li, div, heading...) that is outside every link and
 * outside every block nested in that ancestor. Unbalanced markup throws: a parse that cannot place
 * a link is not evidence that the link is alone.
 */
function linksInContext(html: string): { classes: string[]; text: string; outside: string }[] {
  const out: { classes: string[]; text: string; outside: string }[] = [];
  const stack: Frame[] = [{ tag: "#root", attrs: "", outside: "", links: [], text: "" }];
  const emit = (frame: Frame) => {
    for (const link of frame.links) {
      const classes = link.attrs.match(/\bclass="([^"]*)"/)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
      out.push({ classes, text: link.text.trim(), outside: frame.outside.replace(/\s+/g, " ").trim() });
    }
  };
  for (const token of html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) {
      const tag = token.slice(2, -1).trim().toLowerCase();
      const frame = stack.pop();
      if (!frame || frame.tag !== tag || stack.length === 0) throw new Error(`unbalanced markup: </${tag}> closes <${frame?.tag ?? "nothing"}>`);
      if (tag === "a") [...stack].reverse().find((f) => !INLINE.has(f.tag))!.links.push({ attrs: frame.attrs, text: frame.text });
      emit(frame);
      continue;
    }
    if (token.startsWith("<")) {
      const name = token.match(/^<([\w-]+)/)?.[1]?.toLowerCase();
      if (!name) throw new Error(`unreadable tag: ${token.slice(0, 40)}`);
      if (token.endsWith("/>") || VOID.has(name)) continue;
      stack.push({ tag: name, attrs: token, outside: "", links: [], text: "" });
      continue;
    }
    // Text: every open element holds it. It shares a frame's lines when only phrasing elements, and no link, lie between.
    stack.forEach((frame, index) => {
      frame.text += token;
      if (stack.slice(index + 1).every((inner) => INLINE.has(inner.tag) && inner.tag !== "a")) frame.outside += token;
    });
  }
  if (stack.length !== 1) throw new Error(`unbalanced markup: <${stack.at(-1)!.tag}> is never closed`);
  emit(stack[0]!);
  return out;
}

/** The rendered names of a sheet's row classes; a row class the module does not render is refused. */
function renderedRowClasses({ css, rendered }: Sheet): Map<string, string> {
  return new Map([...rowClasses(css)].map((local) => {
    const name = rendered(local);
    if (typeof name !== "string" || name === "") throw new Error(`the sheet's row class .${local} has no rendered name`);
    return [name, local] as const;
  }));
}

/** The links of a render that carry a row class of the sheet and share their lines with text. */
function rowLinksInSentences(html: string, sheet: Sheet): string[] {
  const rows = renderedRowClasses(sheet);
  return linksInContext(html)
    .filter((link) => link.outside !== "" && link.classes.some((name) => rows.has(name)))
    .map((link) => `${link.classes.flatMap((name) => rows.get(name) ?? []).join(" ")}: "${link.text}" in "${link.outside}"`);
}

describe("decision 23: a row link never sits inside a sentence", () => {
  it("reads row classes and link contexts the way the rule needs", () => {
    expect([...rowClasses(".a { display: inline-flex; } .b { display: inline; color: red; } .c:hover { min-height: 4px; } @media (x) { .d, .e:focus { min-height: 44px; } }")])
      .toEqual(["a", "d"]);
    // The shape of the defect this round fixes: the old /research markup.
    const css = literal(".textLink { display: inline-flex; min-height: 44px; } .plain { color: blue; }");
    expect(rowLinksInSentences('<p class="m">How it is measured: <a class="textLink" href="/benchmarks">Benchmarks</a></p>', css))
      .toEqual(['textLink: "Benchmarks" in "How it is measured:"']);
    // Phrasing around the link or around the text is still the same sentence; a block beside it is not.
    expect(rowLinksInSentences('<p><strong>Read</strong> <span><a class="textLink" href="/x">x</a></span></p>', css)).toHaveLength(1);
    expect(rowLinksInSentences('<p><strong>Read</strong> <a class="textLink" href="/x">x</a></p>', css)).toHaveLength(1);
    expect(rowLinksInSentences('<li><p>01</p><h3>Title</h3><p>Text.</p><a class="textLink" href="/x">x</a></li>', css)).toEqual([]);
    expect(rowLinksInSentences('<p>Read the <a class="plain" href="/x">x</a>.</p>', css)).toEqual([]);
    // A link alone in its row passes, whitespace and comments included.
    expect(rowLinksInSentences('<p class="m">Sentence.</p><a class="textLink" href="/b">B<!-- --></a>', css)).toEqual([]);
    expect(() => linksInContext("<p><a>x</p>")).toThrow(/unbalanced/);
    expect(() => linksInContext("<p>x")).toThrow(/never closed/);
  });

  it.each([
    ["research", ResearchBody],
    ["platform", PlatformBody],
    ["journal", JournalBody],
    ["world", WorldBody],
  ] as const)("/%s has no row link inside a sentence", (route, Body) => {
    const html = renderToStaticMarkup(createElement(Body));
    // Not vacuous: the render has links and the sheet has row classes for the rule to apply to.
    expect(linksInContext(html).length).toBeGreaterThan(0);
    expect(renderedRowClasses(SHEETS[route]).size).toBeGreaterThan(0);
    expect(rowLinksInSentences(html, SHEETS[route])).toEqual([]);
  });

  it("/research ends the measured sentence before the /benchmarks link, which is its own row", () => {
    const html = renderToStaticMarkup(createElement(ResearchBody));
    const link = linksInContext(html).find((entry) => entry.text === "Benchmarks");
    expect(link?.outside).toBe("");
    expect(link?.classes.map((name) => renderedRowClasses(SHEETS.research).get(name))).toContain("textLink");
  });

  /*
    /enterprise's `.inline` links sit in its prose with the 44 px box from before this work order;
    decision 21 hands them to WO-CI-30. They are pinned here by class so that no other row link
    joins them; when WO-CI-30 makes them plain this list is emptied, not widened.
  */
  it("/enterprise has no row link inside a sentence apart from WO-CI-30's .inline links", () => {
    const html = renderToStaticMarkup(createElement(EnterpriseBody));
    const found = rowLinksInSentences(html, SHEETS.enterprise);
    expect(found.length).toBeGreaterThan(0);
    for (const entry of found) expect(entry, entry).toMatch(/^inline: /);
  });
});

describe("TrustNext's heading level comes from its host", () => {
  const tag = (heading: "h2" | "h3") =>
    renderToStaticMarkup(createElement(TrustNext, { from: "/evidence", heading })).match(/<(h\d)>Next: /)?.[1];

  it("renders the level the host names", () => {
    expect(tag("h2")).toBe("h2");
    expect(tag("h3")).toBe("h3");
  });

  it("has no default level and refuses one that is not a level", () => {
    // @ts-expect-error -- `heading` is required: a host that names no level does not compile.
    expect(() => renderToStaticMarkup(createElement(TrustNext, { from: "/evidence" }))).toThrow(/heading must be one of h2, h3/);
    // @ts-expect-error -- and a value that is not a level is refused at run time as well.
    expect(() => renderToStaticMarkup(createElement(TrustNext, { from: "/evidence", heading: "div" }))).toThrow(/got div/);
  });

  it("is a sub-heading on the V34 hosts that render it inside a Section", () => {
    for (const html of [
      renderToStaticMarkup(createElement(EvidenceBody, { view: sampleEvidencePage() })),
      renderToStaticMarkup(createElement(ProgramBody)),
    ]) {
      expect(html).toMatch(/<div class="stack trust-next"><h3>Next: /);
    }
  });
});
