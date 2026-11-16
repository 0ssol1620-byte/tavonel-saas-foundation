import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgramBody } from "@/components/v34/routes/research-program/program";
import { metadata } from "@/app/research/program/page";
import { AREAS, HERO, METHOD, RETAINED } from "@/components/v34/routes/research-program/program-content";
import { v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for /research/program (app/research/program/page.tsx and
  components/v34/routes/research-program/**). The page is the former /research body, moved: what
  these tests pin is that its sentences are all still there, that it renders inside the V34 frame
  under the research shell, and that it carries the metadata a registry row will carry.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes/research-program");

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const sources = (existsSync(dir) ? filesUnder(dir) : []).map((path) => ({
  file: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));
const code = sources.filter((f) => /\.tsx?$/.test(f.file));
const styles = sources.filter((f) => f.file.endsWith(".css"));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const stripped = (list: typeof sources) => list.map((f) => ({ file: f.file, text: stripComments(f.text) }));
const page = stripComments(readFileSync(join(root, "app/research/program/page.tsx"), "utf8"));
const html = renderToStaticMarkup(createElement(ProgramBody));
const decoded = html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

describe("route files", () => {
  it("has the body, its words and its sheet", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual(["program-content.ts", "program.module.css", "program.tsx"]);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("app/research/program/page.tsx", () => {
  it("renders inside the V34 frame under the research shell", () => {
    expect(page).toContain('<V34Page route="research">');
    expect(page).toContain("routeViewport()");
    expect(page).not.toMatch(/PolicyJumpIndex|PublicSitePage|TrustNext|IndexedPolicyBody/);
  });

  it("carries a title and description a registry row would accept, on its own canonical", () => {
    const title = String(metadata.title);
    const description = String(metadata.description);
    expect(title.length).toBeGreaterThanOrEqual(50);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/ — TAVONEL$/);
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).not.toContain(";");
    expect(metadata.alternates?.canonical).toBe("/research/program");
    expect(metadata.openGraph?.url).toBe("/research/program");
  });

  it("agrees with the registry the day a row exists", () => {
    const row = v34RouteByPath("/research/program" as never);
    if (row) {
      expect(row.title).toBe(metadata.title);
      expect(row.description).toBe(metadata.description);
      expect(row.release).toBe("live");
    }
    expect(v34Route("research").path).toBe("/research");
  });
});

describe("one h1", () => {
  it("writes no h1 of its own and mounts exactly one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/program.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1, the program's own", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`>${HERO.title}</h1>`);
  });
});

describe("the moved body is whole", () => {
  it("keeps the seven research areas, in order, each a card with its sentence", () => {
    expect(AREAS.items).toHaveLength(7);
    expect(AREAS.items.map(([title]) => title)).toEqual([
      "Document reading", "Semantic identity", "Knowledge construction", "Evidence coverage",
      "Temporal integrity", "Cost of staying current", "Model independence",
    ]);
    for (const [title, body] of AREAS.items) {
      expect(decoded, title).toContain(title);
      expect(decoded, title).toContain(body);
    }
    expect(html.match(/<article\b/g)).toHaveLength(AREAS.items.length);
  });

  it("keeps the four reporting rules in order, each with its sentence", () => {
    expect(METHOD.items.map(([title]) => title)).toEqual([
      "Freeze the configuration", "Publish the denominator", "Link every number to its receipt", "Reproduce before comparing",
    ]);
    for (const [title, body] of METHOD.items) {
      expect(decoded, title).toContain(title);
      expect(decoded, title).toContain(body);
    }
  });

  it("keeps the role line the trust guards look for, and the competitor rule's wording", () => {
    expect(html).toContain("which problems are still open");
    expect(decoded).toContain("A competitor's published score is quoted as theirs, never restated as something we reproduced.");
  });

  it("keeps the way onward: the notes, the sibling hubs and the next step", () => {
    for (const path of [RETAINED.notes, RETAINED.benchmarks, RETAINED.reproducibility, RETAINED.trust, v34Route("evidence").path]) {
      expect(html, path).toContain(`href="${path}"`);
    }
    expect(html).toContain("Read what was measured");
  });

  it("ends on the shared trust step, TrustNext from /research, as the crosswalk moves it", () => {
    const body = stripped(code).find((f) => f.file.endsWith("/program.tsx"))!;
    expect(body.text).toContain('<TrustNext from="/research" />');
    expect(html).toContain("trust-next");
    expect(decoded).toContain("Next: Research notes");
    expect(decoded).toContain("What has actually been measured?");
  });
});

describe("the evidence rules", () => {
  const text = stripped(code).map((f) => f.text).join("\n");

  it("types no price and no figure, and calls nothing accuracy", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\baccura/i);
    expect(text).not.toMatch(/\bGPU\b/);
  });

  // `/research` is the typed `from` of TrustNext, the page's own step in the trust sequence.
  it("types no path except the retained pages that have no registry key", () => {
    const literal = stripped(code).flatMap((f) => [...f.text.matchAll(/["'`]\/[a-z][^"'`]*/g)].map((m) => m[0]));
    expect(literal.sort()).toEqual(['"/benchmarks', '"/research', '"/research/notes', '"/reproducibility', '"/trust'].sort());
  });
});

describe("tokens, containment and motion", () => {
  it("uses no colour literal and reads only --v34-* custom properties", () => {
    for (const f of stripped(sources)) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
    for (const f of stripped(styles)) for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
  });

  it("hides no overflow and has no motion", () => {
    for (const f of stripped(styles)) {
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes|@import)\b/);
    }
  });
});
