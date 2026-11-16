import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { readCapabilities } from "@/lib/capabilities";
import { readStatusBounded } from "@/components/v34/routes/capabilities/capabilities-status";
import { CONTRACT_CLAUSES, CONTRACT_STATE } from "@/lib/compiler-contract";
import { MCP_TOOLS } from "@/lib/mcp-tools";
import { CapabilitiesBody } from "@/components/v34/routes/capabilities/capabilities";
import { CAPABILITIES_DESTINATIONS } from "@/components/v34/routes/capabilities/capabilities-content";
import { capabilityCensus } from "../../../shared/capabilityManifest";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the /capabilities route (components/v34/routes/capabilities/** and
  app/capabilities/page.tsx), plus one server render. Followed from home-page.test.ts.
*/

const KEY = "capabilities";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes", KEY);

const files = readdirSync(dir).map((name) => ({ file: relative(root, join(dir, name)).replaceAll("\\", "/"), text: readFileSync(join(dir, name), "utf8") }));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const code = files.filter((f) => /\.tsx?$/.test(f.file)).map((f) => ({ ...f, text: stripComments(f.text) }));
const styles = files.filter((f) => f.file.endsWith(".css")).map((f) => ({ ...f, text: stripComments(f.text) }));
const text = code.map((f) => f.text).join("\n");
const render = (status: Parameters<typeof CapabilitiesBody>[0]["status"], failed: boolean) =>
  renderToStaticMarkup(createElement(CapabilitiesBody, { status, failed }));
const OPEN_STATUS = {
  mode: "foundation",
  activationPolicy: { customerIntake: { enabled: true }, cdr: { enabled: true }, ocrGpu: { enabled: true } },
  auth: "google_oauth_configured",
  billing: "sandbox_checkout_ready",
  r2: "signer_configured",
};
const html = render(OPEN_STATUS, false);
const failedHtml = render(null, true);
const page = stripComments(readFileSync(join(root, "app", KEY, "page.tsx"), "utf8"));

describe("capabilities page", () => {
  it("uses a registry key, the release gate and the registry metadata", () => {
    expect(V34_ROUTE_KEYS).toContain(KEY);
    expect(page).toContain(`releaseGate("${KEY}")`);
    expect(page).toContain(`routeMetadata("${KEY}")`);
    expect(page).toContain("routeViewport()");
    expect(page).not.toContain("RouteStub");
  });

  it("is English only", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  });

  it("renders exactly one h1, the registry title, and writes none of its own", () => {
    for (const f of code) expect(f.text, f.file).not.toMatch(/<h1\b/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(v34Route(KEY).title.replace(/ — TAVONEL$/, ""));
  });
});

describe("computed, not typed", () => {
  it("types no price, plan, tool name or figure", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, offer.label).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const [name] of MCP_TOOLS) expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    // The copy lives in the content file; the component holds drawing geometry, which is numbers by nature.
    const copy = code.find((f) => f.file.endsWith("-content.ts"))!.text;
    for (const pattern of [/\b\d{1,3}(?:,\d{3})+\b/, /\b\d+\.\d+\b/, /\b\d{2,}\b/, /\d\s?%/]) expect(copy).not.toMatch(pattern);
  });

  it("prints every clause and its state from the contract, and the counts from the manifest", () => {
    for (const clause of CONTRACT_CLAUSES) {
      expect(html).toContain(`id="${clause.id}"`);
      expect(html).toContain(clause.name);
      expect(html).toContain(CONTRACT_STATE[clause.state].label);
    }
    const census = capabilityCensus();
    for (const n of [census.total, census.accepted, census.converted]) expect(html).toContain(`>${n}</dd>`);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe("deployment grid", () => {
  it("prints every readCapabilities row", () => {
    const rows = readCapabilities(OPEN_STATUS, false);
    expect(rows.some((r) => r.state === "Open")).toBe(true);
    for (const row of rows) {
      expect(html).toContain(row.name);
      expect(html).toContain(row.state);
    }
  });

  it("fails closed: a status read that fails shows no Open or Configured row", () => {
    for (const row of readCapabilities(null, true)) expect(failedHtml).toContain(row.name);
    expect(failedHtml).toContain("Unknown");
    expect(failedHtml).not.toMatch(/>(?:Open|Configured)</);
  });

  it("treats a throw, a timeout and a malformed body as failed", async () => {
    expect(await readStatusBounded(async () => { throw new Error("down"); })).toEqual({ status: null, failed: true });
    expect(await readStatusBounded(() => new Promise(() => {}), 20)).toEqual({ status: null, failed: true });
    expect(await readStatusBounded(async () => "ok")).toEqual({ status: null, failed: true });
    expect(await readStatusBounded(async () => null)).toEqual({ status: null, failed: true });
    expect(await readStatusBounded(async () => ({ mode: "foundation" }))).toEqual({ status: { mode: "foundation" }, failed: false });
  });

  it("is rendered per request", () => {
    expect(page).toContain('dynamic = "force-dynamic"');
  });
});

describe("copy", () => {
  it("drops what the register row removes", () => {
    for (const word of [/\bL\d+\b/, /Verified Skills/i, /Tested methods/i, /Transparent metering/i, /reservations/i]) {
      expect(html).not.toMatch(word);
    }
  });

  it("states what things are, with no defensive disclaimer", () => {
    const content = code.find((f) => f.file.endsWith("capabilities-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });
});

describe("links", () => {
  const allowed = ["/sources"];

  it("types no path except the retained one it names", () => {
    for (const f of code) {
      for (const [literal] of f.text.matchAll(/["'`]\/[a-z][^"'`$]*/g)) {
        expect(allowed, `${f.file}: ${literal}`).toContain(literal.slice(1));
      }
    }
  });

  it("links only to live registry routes or to a retained page that exists", () => {
    expect(CAPABILITIES_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of CAPABILITIES_DESTINATIONS) {
      const route = v34RouteByPath(path);
      if (route) expect(route.release, `${path} is held`).toBe("live");
      else expect(existsSync(join(root, "app", path, "page.tsx")), `${path} has no page`).toBe(true);
    }
  });

  it("links the formats table to /sources", () => {
    expect(CAPABILITIES_DESTINATIONS).toContain("/sources");
    expect(html).toContain('href="/sources"');
  });
});

describe("sheet", () => {
  it("uses tokens only, pairs every background with a colour, hides no overflow and has no motion", () => {
    for (const f of styles) {
      expect(f.text, f.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.text, f.file).not.toMatch(/\b(?:rgba?|hsla?|color-mix)\(/i);
      for (const [, name] of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) expect(name, f.file).toMatch(/^--v34-/);
      for (const [, selector, body] of f.text.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)) {
        if (/(?:^|;|\s)background(?:-color)?\s*:/.test(body!)) expect(body, selector!.trim()).toMatch(/(?:^|;|\s)color\s*:/);
      }
      expect(f.text).not.toMatch(/overflow(?:-[xy])?\s*:\s*hidden|@import\b|\b(?:animation|transition|@keyframes)\b/);
    }
  });
});
