import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrustNext } from "@/components/trust-next";
import { EnterpriseBody } from "@/components/v34/routes/enterprise/enterprise";
import { EvidenceBody } from "@/components/v34/routes/evidence/evidence";
import { JournalBody } from "@/components/v34/routes/journal/journal";
import { PlatformBody } from "@/components/v34/routes/platform/platform";
import { ProgramBody } from "@/components/v34/routes/research-program/program";
import { ResearchBody } from "@/components/v34/routes/research/research";
import { WorldBody } from "@/components/v34/routes/world/world";
import { sampleEvidencePage } from "@/lib/evidence-regions";
import { ContactBody } from "@/components/v34/routes/contact/contact";
import { DevelopersBody } from "@/components/v34/routes/developers/developers";
import { SecurityBody } from "@/components/v34/routes/security/security";
import { inSentenceViolations } from "./in-sentence-guard";
import { reach } from "./import-graph";
import contactModule from "@/components/v34/routes/contact/contact.module.css";
import developersModule from "@/components/v34/routes/developers/developers.module.css";
import programModule from "@/components/v34/routes/research-program/program.module.css";
import securityModule from "@/components/v34/routes/security/security.module.css";
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

/** The rendered names of the row classes of one sheet or several; a row class the module does not render is refused. */
function renderedRowClasses(sheets: Sheet | Sheet[]): Map<string, string> {
  return new Map([sheets].flat().flatMap(({ css, rendered }) => [...rowClasses(css)].map((local) => {
    const name = rendered(local);
    if (typeof name !== "string" || name === "") throw new Error(`the sheet's row class .${local} has no rendered name`);
    return [name, local] as const;
  })));
}

/**
 * Every CSS module a route's body reaches through its imports (its own sheet and the sheets of the modules it
 * imports: a sample frame, a shared card), as sheets. A row class declared in a module the route's own sheet
 * does not name is still a row class of that page.
 */
async function reachedSheets(entry: string): Promise<Sheet[]> {
  const files = [...reach(ROOT, entry)].filter((file) => file.endsWith(".module.css"));
  return Promise.all(files.map(async (file) => {
    const sheetModule = (await import(/* @vite-ignore */ `@/${file}`)) as { default: Record<string, string> };
    return { css: readFileSync(join(ROOT, file), "utf8"), rendered: (local: string) => sheetModule.default[local] };
  }));
}

/** The links of a render that carry a row class of the sheet(s) and share their lines with text. */
function rowLinksInSentences(html: string, sheet: Sheet | Sheet[]): string[] {
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
    WO-CI-30. /enterprise's `.inline` links and the sample frame's `.link` were the last row classes in a
    sentence (decision 21 handed them over); both are plain inline now. The route's body reaches two sheets,
    and the guard reads both.
  */
  it("/enterprise has no row link inside a sentence, in its own sheet or in a sheet it imports", async () => {
    const html = renderToStaticMarkup(createElement(EnterpriseBody));
    const sheets = await reachedSheets("components/v34/routes/enterprise/enterprise.tsx");
    expect(sheets.length, "the enterprise body reaches its own sheet and the sample frame's").toBeGreaterThanOrEqual(2);
    expect(renderedRowClasses(sheets).size).toBeGreaterThan(0);
    expect(rowLinksInSentences(html, sheets)).toEqual([]);
    // The in-sentence classes themselves are plain, and the enterprise one is rendered in sentences.
    for (const [sheetName, name] of [["enterprise", "inline"], ["sample-frame", "link"]] as const) {
      const css = readFileSync(join(ROOT, "components/v34/routes/enterprise", `${sheetName}.module.css`), "utf8");
      expect(inSentenceViolations(css, name), `${sheetName} .${name}`).toEqual([]);
    }
    expect(linksInContext(html).filter((link) => link.classes.includes(enterpriseModule.inline!) && link.outside !== "").length).toBeGreaterThan(0);
  });

  it("reads a row class that only a sheet imported by the route declares", () => {
    const own = literal(".x { color: red; }");
    const imported = literal(".card { display: inline-flex; min-height: 44px; }");
    const html = '<p>See <a class="card" href="/x">the card</a> here.</p>';
    expect(rowLinksInSentences(html, own)).toEqual([]);
    expect(rowLinksInSentences(html, [own, imported])).toEqual(['card: "the card" in "See here."']);
  });
});

/*
  WO-CI-30 item 3. The same in-sentence row for every V34 sheet whose link class is read inside a sentence:
  the class is rendered, every link carrying it shares its lines with text, and the guard of lead decision 23
  (lib/v34/in-sentence-guard.ts, which walks nested blocks and pseudo-elements) finds nothing in its sheet.
  Self-tests of the guard, with one mutant per rule, are in in-sentence-guard.test.ts.
*/
describe("decision 23: the in-sentence link class of each V34 sheet is plain and is rendered in sentences", () => {
  const SENTENCE = [
    ["research-program/program", "inlineLink", programModule, () => createElement(ProgramBody)],
    ["developers/developers", "sentenceLink", developersModule, () => createElement(DevelopersBody)],
    ["contact/contact", "inline", contactModule, () => createElement(ContactBody)],
    ["security/security", "inline", securityModule, () => createElement(SecurityBody)],
  ] as const;

  it.each(SENTENCE)("%s .%s", (sheetName, name, module, body) => {
    const css = readFileSync(join(ROOT, "components/v34/routes", `${sheetName}.module.css`), "utf8");
    expect(inSentenceViolations(css, name)).toEqual([]);
    const rendered = module[name];
    expect(typeof rendered, `${sheetName} exports .${name}`).toBe("string");
    const links = linksInContext(renderToStaticMarkup(body())).filter((link) => link.classes.includes(rendered));
    expect(links.length, `${sheetName}: a link carries .${name}`).toBeGreaterThan(0);
    expect(links.filter((link) => link.outside === "").map((link) => link.text), `${sheetName}: every .${name} link shares its lines with text`).toEqual([]);
  });
});

/*
  /connect's `.inlineLink` links render only inside the customer-data gate notice, so with the gate open (the
  state of every build, `activationPolicy.customerData.enabled`) there is nothing to render and no row of the
  browser spec can measure them. They are read here with the gate closed: the module graph is reset, the policy
  is replaced by a copy with the flag false, and the body is rendered from that graph (one React, one module).
*/
describe("decision 23: /connect's in-sentence links, rendered with the customer-data gate closed", () => {
  it("renders .inlineLink inside the notice's sentence, and the sheet makes it plain", async () => {
    vi.resetModules();
    vi.doMock("@/lib/activation-policy", async (original) => {
      const real = await original<typeof import("@/lib/activation-policy")>();
      return { ...real, activationPolicy: { ...real.activationPolicy, customerData: { ...real.activationPolicy.customerData, enabled: false } } };
    });
    try {
      const { createElement: element } = await import("react");
      const { renderToStaticMarkup: render } = await import("react-dom/server");
      const { ConnectBody: Body } = await import("@/components/v34/routes/connect/connect");
      const sheet = (await import("@/components/v34/routes/connect/connect.module.css")).default as Record<string, string>;
      const html = render(element(Body, { remoteOpen: false }));
      const links = linksInContext(html).filter((link) => link.classes.includes(sheet.inlineLink!));
      expect(links.map((link) => link.text), "both notice links carry .inlineLink").toEqual(["Discuss your sources", "Open the public Compiled World"]);
      expect(links.filter((link) => link.outside === "").map((link) => link.text), "and share their lines with the notice's words").toEqual([]);
      expect(inSentenceViolations(readFileSync(join(ROOT, "components/v34/routes/connect/connect.module.css"), "utf8"), "inlineLink")).toEqual([]);
      // With the gate open the same body renders none of them: the reason the browser spec has no /connect row.
    } finally {
      vi.doUnmock("@/lib/activation-policy");
      vi.resetModules();
    }
    const { createElement: element } = await import("react");
    const { renderToStaticMarkup: render } = await import("react-dom/server");
    const { ConnectBody: Body } = await import("@/components/v34/routes/connect/connect");
    const sheet = (await import("@/components/v34/routes/connect/connect.module.css")).default as Record<string, string>;
    expect(linksInContext(render(element(Body, { remoteOpen: false }))).filter((link) => link.classes.includes(sheet.inlineLink!))).toEqual([]);
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
