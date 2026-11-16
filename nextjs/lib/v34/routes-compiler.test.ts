import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompilerBody } from "@/components/v34/routes/compiler/compiler";
import { COMPILER_DESTINATIONS, COMPILER_FILES } from "@/components/v34/routes/compiler/compiler-content";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import { clause } from "@/lib/compiler-contract";
import { DEVELOPER_FILES } from "@/lib/mcp-tools";
import { CAPABILITY_MANIFEST, capabilityCensus, isAcceptedAtUpload, sharedAcceptedLimitationLabels } from "../../../shared/capabilityManifest";
import { MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { routeMetadata } from "./route-metadata";
import { v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the compiler route (app/compiler/page.tsx and components/v34/routes/compiler/**),
  plus one server render. The rules that keep a route honest are pinned here as text checks, the way
  home-page.test.ts pins them for the home route: a figure that is not computed, a price, a plan or
  a tool name typed by hand, a second h1, a colour that is not a token, a link to a held page, a
  sentence the register row removed. The art file is exempt from the figure scan alone: its numbers
  are drawing coordinates, and it holds no sentence.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const routeDir = join(root, "components/v34/routes/compiler");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const sources = filesUnder(routeDir).map((path) => ({ file: relative(root, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));
const code = sources.filter((f) => /\.tsx?$/.test(f.file));
const copy = code.filter((f) => !f.file.endsWith("-art.tsx"));
const styles = sources.filter((f) => f.file.endsWith(".css"));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const stripped = (list: typeof sources) => list.map((f) => ({ file: f.file, text: stripComments(f.text) }));
const copyText = stripped(copy).map((f) => f.text).join("\n");
const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

const html = renderToStaticMarkup(createElement(CompilerBody));

describe("compiler route files", () => {
  it("has the component, its content, its art and its sheet", () => {
    expect(sources.map((f) => f.file.split("/").pop()).sort()).toEqual(["compiler-art.tsx", "compiler-content.ts", "compiler.module.css", "compiler.tsx"]);
  });

  it("is English only", () => {
    for (const f of sources) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });
});

describe("app/compiler/page.tsx", () => {
  const page = stripComments(readFileSync(join(root, "app/compiler/page.tsx"), "utf8"));

  it("is the thin V34 page: registry metadata, the gate before anything renders, a dynamic primary action", () => {
    expect(page).toContain('routeMetadata("compiler")');
    expect(page).toContain("routeViewport()");
    expect(page).toContain("<Compiler />");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    const gate = page.indexOf('await releaseGate("compiler")');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(page.indexOf("return"));
  });

  it("is a live registry route whose metadata and h1 are the registry's words", () => {
    const route = v34Route("compiler");
    expect(route.release).toBe("live");
    expect(routeMetadata("compiler").title).toBe(route.title);
    expect(html).toContain(`<h1`);
    expect(html).toContain(escapeHtml(route.title.replace(/ — TAVONEL$/, "")));
    expect(html).toContain(escapeHtml(route.description));
  });
});

describe("one h1", () => {
  it("writes no h1 of its own and mounts exactly one Hero", () => {
    for (const f of stripped(code)) expect(f.text, f.file).not.toMatch(/<h1\b/);
    const body = stripped(code).find((f) => f.file.endsWith("/compiler.tsx"))!;
    expect(body.text.match(/<Hero\b/g)).toHaveLength(1);
  });

  it("renders exactly one h1", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});

describe("numbers are computed, prices and plans come from the catalog, tools from the tool list", () => {
  it("types no price", () => {
    expect(copyText).not.toMatch(/[$€£₩]\s?\d/);
    expect(copyText).not.toMatch(/\b(?:USD|per month|per year|a month|a year)\b/i);
    expect(copyText).not.toMatch(/\bpriceUsd\b/);
  });

  it("names no plan by hand", () => {
    for (const offer of Object.values(BILLING_OFFERS)) {
      expect(copyText, `plan label "${offer.label}"`).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    }
  });

  it("names no MCP tool by hand", () => {
    for (const name of MCP_TOOL_NAMES) expect(copyText, name).not.toContain(name);
  });

  it("writes no figure: no grouped, decimal or three-digit number, no percentage, no count-plus-noun", () => {
    expect(copyText).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/);
    expect(copyText).not.toMatch(/\b\d+\.\d+\b/);
    expect(copyText).not.toMatch(/\b\d{3,}\b/);
    expect(copyText).not.toMatch(/\d\s?%/);
    expect(copyText).not.toMatch(/\b\d+\s+(?:records?|relationships?|sources?|documents?|pages?|files?|days?|minutes?|seconds?|tools?|formats?)\b/i);
  });

  it("renders nothing undefined", () => {
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });

  it("prints the format table from the capability manifest, one row per accepted format", () => {
    const accepted = CAPABILITY_MANIFEST.entries.filter((entry) => isAcceptedAtUpload(entry.status));
    expect(accepted.length).toBe(capabilityCensus().accepted);
    expect(html.match(/<th scope="row"/g)).toHaveLength(accepted.length);
    for (const entry of accepted) for (const extension of entry.extensions) expect(html).toContain(extension.toUpperCase());
    for (const label of sharedAcceptedLimitationLabels()) expect(html).toContain(escapeHtml(label));
    expect(html).toContain(capabilityCensus().accepted.toLocaleString("en-US"));
  });

  it("lists a card for every loaded public source and counts both kinds from the corpus", () => {
    const stats = PUBLIC_CORPUS_STATS();
    const loaded = Object.values(readPublicCorpus().sources).filter((source) => source[1] !== "Source catalog");
    expect(loaded.length).toBe(stats.sources.loaded);
    for (const [name, , href] of loaded) {
      expect(html).toContain(escapeHtml(name));
      expect(html).toContain(escapeHtml(href));
    }
    expect(html).toContain(`${stats.sources.loaded} sources are loaded`);
    expect(html).toContain(`${stats.sources.referenceOnly} more public catalogs`);
    expect(html).toContain("Public reference corpus");
  });

  it("keeps the publisher link of every reference-only source, from the corpus", () => {
    const catalogs = Object.values(readPublicCorpus().sources).filter((source) => source[1] === "Source catalog");
    expect(catalogs.length).toBe(PUBLIC_CORPUS_STATS().sources.referenceOnly);
    for (const [name, , href] of catalogs) {
      expect(html).toContain(escapeHtml(name));
      expect(html).toContain(`href="${escapeHtml(href)}"`);
    }
  });

  it("states what a region carries only while the evidence clause is still demonstrated, and downloads a published verifier", () => {
    expect(clause("evidence-preserving").state).toBe("demonstrated");
    expect(copyText).toContain("clause(\"evidence-preserving\").state !== \"demonstrated\"");
    expect(COMPILER_FILES).toEqual(["/developer/tavonel-verify-package.mjs"]);
    expect(DEVELOPER_FILES.some((entry) => COMPILER_FILES[0] === `/developer/${entry.file}`)).toBe(true);
  });
});

describe("what the register row removed stays out", () => {
  it("writes none of the removed claims", () => {
    for (const phrase of ["HWP", "Calibrated", "retry fee", "bypass OCR", "Target format", "Parser candidate", "Independent judge", "Billing"]) {
      expect(copyText.toLowerCase(), phrase).not.toContain(phrase.toLowerCase());
      expect(html.toLowerCase(), phrase).not.toContain(phrase.toLowerCase());
    }
  });

  it("states what things are, with no defensive disclaimer", () => {
    const content = stripped(copy).find((f) => f.file.endsWith("-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });
});

describe("tokens and explicit pairs", () => {
  it("uses no colour literal in the sheet or in code", () => {
    for (const f of stripped(sources)) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i);
    }
  });

  it("names no basic colour and reads only --v34-* custom properties", () => {
    for (const f of stripped(styles)) {
      expect(f.text, f.file).not.toMatch(/(?:color|background|border[\w-]*|outline[\w-]*|fill|stroke)\s*:[^;]*\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)\b/i);
      for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
    }
  });

  it("sets a foreground wherever it paints a background", () => {
    for (const f of stripped(styles)) {
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (!/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) continue;
        expect(body, `${f.file}: ${selector!.trim()} paints a background without a colour`).toMatch(/(?:^|;|\s)color\s*:/);
      }
    }
  });

  it("hides no overflow, imports nothing and has no motion of its own", () => {
    for (const f of stripped(styles)) {
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden/);
      expect(f.text).not.toMatch(/@import\b/);
      expect(f.text).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
    }
  });
});

describe("links", () => {
  it("types no path except the retained ones it names", () => {
    const allowed = ["/developer", "/sources"];
    for (const f of stripped(copy)) {
      for (const [literal] of f.text.matchAll(/["'`]\/[a-z][^"'`$]*/g)) {
        const path = literal.slice(1);
        expect(allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)), `${f.file}: ${literal}`).toBe(true);
      }
    }
  });

  it("links only to live routes or to a retained page that exists", () => {
    expect(COMPILER_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of COMPILER_DESTINATIONS) {
      const route = v34RouteByPath(path);
      if (route) expect(route.release, `${path} is held`).toBe("live");
      else expect(existsSync(join(root, "app", path, "page.tsx")), `${path} is neither registered nor a page`).toBe(true);
    }
  });

  it("renders only links that resolve: a live registry route, a retained page or a published file", () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (/^https?:\/\//.test(href) || href.startsWith("#")) continue;
      const path = href.split(/[?#]/)[0]!;
      if (path.startsWith("/developer/")) {
        expect(existsSync(join(root, "public", path)), `${href} is not a published file`).toBe(true);
        continue;
      }
      const route = v34RouteByPath(path);
      if (route) expect(route.release, `${href} is held`).toBe("live");
      else expect(existsSync(join(root, "app", path, "page.tsx")), `${href} has no page`).toBe(true);
    }
  });

  it("opens the primary action before the art in the document", () => {
    expect(html.indexOf("Create your World")).toBeGreaterThan(-1);
    expect(html.indexOf("Create your World")).toBeLessThan(html.indexOf("<svg"));
  });

  it("names its art and tags it as an illustration", () => {
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="[^"]+"/);
    expect(html).toContain("Illustration");
  });
});
