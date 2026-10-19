import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
  The keyless try-it, rendered where it is mounted (EN-4).

  What has to hold on every mount: the same three keyless GETs, the terminal recipes taken from
  /docs/integration-recipes rather than typed again, a way to the human view at /explore, and no
  field a key could be typed into. On the quickstart it is the first thing in the article, above
  the intake note. The three digest outcomes are rendered here too; which one a run reaches is
  pinned against a mocked fetch in `keyless-read.test.ts`.
*/

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs/quickstart",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { KeylessTryIt, KEYLESS_READS, recipeBody } = await import("../components/docs/keyless-try-it");
const { ReadResult } = await import("../components/docs/api-try-it");
const { default: DocsSectionPage } = await import("../app/docs/[section]/page");
const { default: DevelopersPage } = await import("../app/developers/page");
const { default: ApiReferencePage } = await import("../app/api/page");
const { findDocsSection } = await import("./docs-content");

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The try-it's own markup out of a whole page. It holds no nested <section>. */
function tryItIn(html: string) {
  const at = html.indexOf("data-keyless-try-it");
  expect(at, "the page does not mount the keyless try-it").toBeGreaterThan(-1);
  const open = html.lastIndexOf("<section", at);
  return html.slice(open, html.indexOf("</section>", at) + "</section>".length);
}

const quickstart = renderToStaticMarkup(await DocsSectionPage({ params: Promise.resolve({ section: "quickstart" }) }));
const pages = {
  "/docs/quickstart": quickstart,
  "/developers": renderToStaticMarkup(createElement(DevelopersPage)),
  "/api": renderToStaticMarkup(await ApiReferencePage()),
};

describe("the keyless try-it mount", () => {
  const html = renderToStaticMarkup(createElement(KeylessTryIt));

  it("runs exactly the three unauthenticated GETs", () => {
    expect(KEYLESS_READS.map((route) => route.path)).toEqual(["/api/v1/capabilities", "/api/status", "/reproducibility/sample-world"]);
    for (const route of KEYLESS_READS) expect(text(html)).toContain(`GET ${route.path}`);
    expect(html.match(/<button[^>]*class="btn ghost"/g)).toHaveLength(3);
  });

  it("offers no field a key could be typed into", () => {
    expect(html).not.toMatch(/<input|<textarea|contenteditable/i);
    expect(html).not.toMatch(/authorization|bearer|api[_ -]?key/i);
  });

  it("prints the curl and Python recipes from /docs/integration-recipes, with a copy button each", () => {
    const recipes = findDocsSection("integration-recipes")!.blocks.filter((block) => block.kind === "code");
    for (const label of ["What TAVONEL can read, publish and sign", "Read the sample and follow one claim to its evidence"]) {
      const block = recipes.find((item) => item.label === label);
      expect(block, `integration-recipes lost "${label}"`).toBeDefined();
      expect(recipeBody(label)).toBe(block!.kind === "code" ? block!.body : "");
      expect(text(html)).toContain(recipeBody(label));
    }
    expect(text(html)).toContain("Copy curl");
    expect(text(html)).toContain("Copy Python");
    expect(() => recipeBody("A recipe nobody wrote")).toThrow(/no code block labelled/);
  });

  /*
    Both copy buttons are on the page, ahead of the closed disclosure that holds the commands to read:
    inside it they were the quickstart's first copy controls and hidden (premium-craft.spec). And the
    try-it adds no `figure.docs-code`, which on /developers is the one first-request sample
    (visual-refinement.spec), on any of its three mounts.
  */
  it("shows its copy buttons outside the disclosure and adds no docs code-block figure", () => {
    const details = html.indexOf("<details");
    expect(details).toBeGreaterThan(-1);
    const copies = [...html.matchAll(/class="docs-copy"/g)].map((match) => match.index!);
    expect(copies).toHaveLength(2);
    for (const at of copies) expect(at).toBeLessThan(details);
    expect(html).not.toContain('class="docs-code"');
    expect(pages["/developers"].match(/<figure class="docs-code"/g)).toHaveLength(1);
  });

  it("links the human view of the same shape, without prefetching the Explore route's scripts", () => {
    expect(html).toContain('href="/explore"');
    // In the quickstart's first viewport a prefetching link loads Explore's chunks with the page:
    // about 31 KB of script, measured, past the §22 budget. Nothing in the markup shows it.
    const source = readFileSync(resolve(import.meta.dirname, "../components/docs/keyless-try-it.tsx"), "utf8");
    expect(source).toMatch(/<Link href=\{EXPLORE_CTA\.href as Route\} prefetch=\{false\}>/);
  });

  it.each(Object.entries(pages))("is mounted once, the same, on %s", (_route, page) => {
    expect(page.match(/data-keyless-try-it/g)).toHaveLength(1);
    expect(tryItIn(page)).toBe(html);
  });

  it("opens the quickstart article, above the intake note, and leaves the note as it was", () => {
    const tryIt = quickstart.indexOf("data-keyless-try-it");
    const note = quickstart.indexOf("Before you start.");
    expect(note, "the intake note is gone").toBeGreaterThan(-1);
    expect(tryIt).toBeLessThan(note);
    expect(text(quickstart)).toContain(
      "So steps 1 to 5 below are the contract you will call once intake is arranged with us, not a request TAVONEL will accept from you today.",
    );
  });

  it("stays off the other documentation sections", async () => {
    const other = renderToStaticMarkup(await DocsSectionPage({ params: Promise.resolve({ section: "authentication" }) }));
    expect(other).not.toContain("data-keyless-try-it");
  });
});

describe("a finished run shows exactly one of three digest outcomes", () => {
  const base = { status: 200, ms: 12, bytes: 1584, body: '{\n  "schema": "x"\n}' };
  const render = (digest: Parameters<typeof ReadResult>[0]["result"]) => renderToStaticMarkup(createElement(ReadResult, { result: digest }));

  const match = render({ ...base, digest: { state: "match", value: "sha-256=:AAA=:" } });
  const mismatch = render({ ...base, digest: { state: "mismatch", served: "sha-256=:AAA=:", computed: "sha-256=:BBB=:" } });
  const absent = render({ ...base, digest: { state: "absent" } });

  it("says each outcome in words, and only that one", () => {
    const outcomes = { match, mismatch, absent };
    for (const [state, html] of Object.entries(outcomes)) {
      expect(html.match(/data-digest="(\w+)"/g), state).toEqual([`data-digest="${state}"`]);
    }
    expect(text(match)).toContain("Content-Digest matches the 1,584 bytes received: sha-256=:AAA=:");
    expect(text(absent)).toContain("No Content-Digest header on this response");
    expect(text(mismatch)).toContain("Content-Digest does not match these bytes.");
    expect(text(mismatch)).toContain("Served sha-256=:AAA=:");
    expect(text(mismatch)).toContain("Computed sha-256=:BBB=:");
  });

  it("withholds the body on a mismatch and shows it otherwise", () => {
    expect(mismatch).not.toContain("<pre>");
    expect(text(mismatch)).not.toContain('"schema"');
    expect(match).toContain("<pre>");
    expect(absent).toContain("<pre>");
  });

  it("never calls a match verified", () => {
    for (const html of [match, mismatch, absent]) expect(html.toLowerCase()).not.toContain("verified");
  });

  it("keeps the request error apart from the digest outcomes", () => {
    const failed = renderToStaticMarkup(createElement(ReadResult, { result: { error: "Failed to fetch" } }));
    expect(failed).not.toContain("data-digest");
    expect(text(failed)).toContain("The request did not complete: Failed to fetch");
  });
});
