import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
  Every route says who it is, or this fails.

  Next.js merges metadata down the layout chain, which is convenient and hides a specific
  defect: a page that declares nothing still renders a complete, plausible <head> -- the root
  layout's. Twenty-two routes in this app once shared one canonical ("/") and one description,
  and nothing was visibly broken; a crawler was simply told that the terms page, the security
  page and the homepage were the same document, and a link pasted into Slack previewed the
  homepage pitch whichever page was pasted.

  So inheritance is exactly what is not allowed here. This walks `app/` itself rather than
  reading a list, because the failure mode is a *new* page arriving without metadata, and a
  hand-maintained list is the thing that would not notice.

  What is deliberately not checked: og:image (one static `app/opengraph-image.tsx` covers
  every route by file convention, and inheriting it is correct), and twitter:* (Next derives
  the card from openGraph in `postProcessMetadata`, so asserting a literal `twitter:` key in
  source would fail on pages that are in fact serving a correct card).
*/

const appDir = fileURLToPath(new URL("../app/", import.meta.url));

function routes(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const relative = path.relative(appDir, dir).split(path.sep).join("/");
        found.push(relative === "" ? "/" : `/${relative}`);
      }
    }
  };
  walk(appDir);
  return found.sort();
}

function segmentDir(route: string) {
  return route === "/" ? appDir : path.join(appDir, route.slice(1));
}

/** The page plus the layout in its own segment -- not the layouts above it. */
function ownSource(route: string) {
  const dir = segmentDir(route);
  const parts = [readFileSync(path.join(dir, "page.tsx"), "utf8")];
  const layout = path.join(dir, "layout.tsx");
  if (existsSync(layout)) parts.push(readFileSync(layout, "utf8"));
  return parts.join("\n");
}

/** The balanced `{...}` starting at or after `from`. */
function objectAt(source: string, from: number) {
  const start = source.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Only the metadata object, never the page body.
 *
 * The first version of this read the whole file, and `/workspace` "failed" because a sample
 * PDF path in the markup answered to `url:`. A test that reads the wrong region reports
 * defects that are not there, which is worse than not testing.
 *
 * `generateMetadata` returns more than once -- `/solutions/[slug]` returns `{}` for an unknown
 * slug before it returns the real object -- so every return is collected rather than the first.
 */
function metadataSource(route: string) {
  const source = ownSource(route);
  const blocks: string[] = [];
  for (const match of source.matchAll(/export const metadata[^=]*=\s*/g)) {
    const block = objectAt(source, match.index! + match[0].length - 1);
    if (block) blocks.push(block);
  }
  const declared = source.indexOf("generateMetadata");
  if (declared >= 0) {
    for (const match of source.slice(declared).matchAll(/return\s*\{/g)) {
      const block = objectAt(source, declared + match.index!);
      if (block) blocks.push(block);
    }
  }
  return blocks.join("\n");
}

/**
 * The description literals, including both arms of a ternary.
 *
 * `/terms` and `/refunds` describe themselves differently depending on whether the deployment
 * can take money, which is the whole reason those two pages read a switch. Reading only the
 * literal that follows the colon would find neither.
 */
function descriptionLiterals(block: string) {
  const found: string[] = [];
  for (const match of block.matchAll(/description\s*:\s*/g)) {
    // Walk to the end of this property. Stopping at the next newline would have worked for the
    // multi-line objects and silently swallowed the canonical on the single-line ones.
    let depth = 0;
    let quote = "";
    let end = match.index! + match[0].length;
    for (; end < block.length; end += 1) {
      const character = block[end];
      if (quote) {
        if (character === "\\") end += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") quote = character;
      else if ("{[(".includes(character)) depth += 1;
      else if ("}])".includes(character)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (character === "," && depth === 0) break;
    }
    const value = block.slice(match.index! + match[0].length, end);
    for (const literal of value.matchAll(/"([^"]+)"/g)) found.push(literal[1]);
  }
  return found;
}

/** `/solutions/${slug}` in a template literal is the honest way to write `/solutions/[slug]`. */
function normalisePath(value: string) {
  return value.replace(/\$\{\s*(\w+)\s*\}/g, "[$1]");
}

function field(block: string, key: string) {
  const match = block.match(new RegExp(key + String.raw`\s*:\s*(["'\`])([^"'\`]*)\1`));
  return match ? normalisePath(match[2]) : null;
}

/** Indexable means the layout chain above it never says otherwise. */
function isIndexable(route: string) {
  let dir = segmentDir(route);
  for (;;) {
    for (const file of ["page.tsx", "layout.tsx"]) {
      const full = path.join(dir, file);
      if (existsSync(full) && /index:\s*false/.test(readFileSync(full, "utf8"))) return false;
    }
    if (path.resolve(dir) === path.resolve(appDir)) return true;
    dir = path.dirname(dir);
  }
}

const ALL = routes();

/*
  Routes that inherit their metadata from a parent segment, on purpose.

  Each re-exports the default component of a page that already declares its own metadata, and
  each sits under a noindex layout. Giving them separate canonicals would invent addresses;
  the parent's is the correct one.
*/
const REEXPORTED = new Set(["/workspace/[surface]", "/workspace/[surface]/[detail]", "/workspace/admin", "/dev/compile-stage"]);

/** Surfaces that must never be indexed: authenticated, transient or internal. */
const MUST_BE_NOINDEX = ["/workspace", "/login", "/auth/callback", "/dev"];

const DECLARING = ALL.filter((route) => !REEXPORTED.has(route));

describe("every route carries its own identity", () => {
  it("finds the routes by walking the tree, so a new page cannot opt out by not being listed", () => {
    expect(ALL).toContain("/");
    expect(ALL).toContain("/security");
    expect(ALL).toContain("/solutions/[slug]");
    expect(ALL.length).toBeGreaterThan(40);
  });

  it.each(DECLARING)("declares metadata on %s", (route) => {
    const source = ownSource(route);
    expect(
      source.includes("export const metadata") || source.includes("generateMetadata"),
      `${route} renders the root layout's <head> because it declares none of its own`,
    ).toBe(true);
    expect(metadataSource(route).length, `${route}: metadata object could not be read`).toBeGreaterThan(10);
  });

  it.each(DECLARING)("gives %s a title and a description of its own", (route) => {
    const block = metadataSource(route);
    const title = field(block, "title");
    expect(title, `${route} inherits the homepage title`).toBeTruthy();
    expect(title!.length).toBeGreaterThan(6);
    expect(title!.length).toBeLessThanOrEqual(72);
    // A description is not decoration: it is the sentence under the link, everywhere the link
    // is pasted. Inherited, it makes the terms page sell the product instead of describing itself.
    expect(
      /description\s*:/.test(block),
      `${route} inherits the homepage description, so a shared link previews the wrong page`,
    ).toBe(true);
  });

  it.each(DECLARING.filter((route) => route !== "/"))("points %s at its own address", (route) => {
    const block = metadataSource(route);
    expect(field(block, "canonical"), `${route} has no canonical of its own`).toBe(route);
    // og:url is the address a share card claims. Left inherited, it claims "/".
    expect(field(block, "url"), `${route} shares a link that says it is the homepage`).toBe(route);
  });

  it.each(MUST_BE_NOINDEX)("keeps %s out of the index", (prefix) => {
    const layout = path.join(appDir, prefix.slice(1), "layout.tsx");
    expect(existsSync(layout), `${prefix} needs a layout to carry robots`).toBe(true);
    expect(readFileSync(layout, "utf8")).toMatch(/index:\s*false/);
  });
});

describe("descriptions are the length a search result shows", () => {
  /*
    Applied to indexable routes only, because the rule is about search results and nothing
    else. Under about 50 characters an engine renders a fragment and substitutes wording it
    picked from the page; over about 200 it truncates mid-sentence. Either way the sentence
    someone wrote is not the sentence anyone reads. A noindex workspace has no such reader,
    and padding "Your governed knowledge space." to satisfy a lint would be writing for a
    test rather than for a person.
  */
  /*
    One route builds its description from page data rather than writing it twice. Listing it
    here is a deliberate act with a reason, not a way to make the check pass.
  */
  const COMPUTED = new Map([
    ["/solutions/[slug]", "the description is the solution's own lede, from the page's data map"],
    ["/docs/[section]", "the description is the section's own summary, from lib/docs-content.ts"],
  ]);

  const indexable = DECLARING.filter(isIndexable);

  it("still covers most of the site, so the exemption is not the rule", () => {
    expect(indexable.length).toBeGreaterThan(ALL.length / 2);
  });

  it.each(indexable)("sizes the description on %s", (route) => {
    const block = metadataSource(route);
    const descriptions = descriptionLiterals(block);
    if (COMPUTED.has(route)) {
      expect(descriptions, `${route}: ${COMPUTED.get(route)}`).toEqual([]);
      return;
    }
    expect(descriptions.length, `${route}: no readable description literal`).toBeGreaterThan(0);
    for (const description of descriptions) {
      expect(description.length, `${route}: "${description}"`).toBeGreaterThanOrEqual(50);
      expect(description.length, `${route}: "${description}"`).toBeLessThanOrEqual(200);
    }
  });
});
