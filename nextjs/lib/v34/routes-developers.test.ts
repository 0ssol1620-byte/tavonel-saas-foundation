import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { FIRST_CALL_OPERATION, FIRST_CALL_SNIPPETS } from "@/lib/developer-snippets";
import { DEVELOPER_FILES, DEVELOPER_FILE_COUNT_WORD, MCP_TOOLS, MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { PACKAGE_CONTENTS } from "@/lib/package-contents";
import { codeTokens } from "@/components/docs/code-tokens";
import { DevelopersBody } from "@/components/v34/routes/developers/developers";
import { DEVELOPERS_DESTINATIONS } from "@/components/v34/routes/developers/developers-content";
import { V34_ROUTE_KEYS, v34Route, v34RouteByPath } from "./routes";

/*
  Source-level guards for the /developers route (components/v34/routes/developers/** and
  app/developers/page.tsx), plus one server render. Followed from home-page.test.ts.
*/

const KEY = "developers";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes", KEY);

const files = readdirSync(dir).map((name) => ({ file: relative(root, join(dir, name)).replaceAll("\\", "/"), text: readFileSync(join(dir, name), "utf8") }));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const code = files.filter((f) => /\.tsx?$/.test(f.file)).map((f) => ({ ...f, text: stripComments(f.text) }));
const styles = files.filter((f) => f.file.endsWith(".css")).map((f) => ({ ...f, text: stripComments(f.text) }));
const text = code.map((f) => f.text).join("\n");
const plain = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const markup = renderToStaticMarkup(createElement(DevelopersBody));
const html = plain(markup);
const shown = plain(markup.replace(/<[^>]+>/g, ""));
const page = stripComments(readFileSync(join(root, "app", KEY, "page.tsx"), "utf8"));

describe("developers page", () => {
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
  it("types no price, plan or tool name", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, offer.label).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const [name] of MCP_TOOLS) expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`));
  });

  it("types no figure in its copy", () => {
    const copy = code.find((f) => f.file.endsWith("developers-content.ts"))!.text;
    for (const pattern of [/\b\d{1,3}(?:,\d{3})+\b/, /\b\d+\.\d+\b/, /\b\d{2,}\b/, /\d\s?%/]) expect(copy).not.toMatch(pattern);
  });

  it("prints the tools, the counts and the file list from lib/mcp-tools.ts", () => {
    expect(html).toContain(`${MCP_TOOL_COUNT_WORD} tools that read`);
    expect(html).toContain(`${DEVELOPER_FILE_COUNT_WORD[0]!.toUpperCase()}${DEVELOPER_FILE_COUNT_WORD.slice(1)} files`);
    for (const [name, description] of MCP_TOOLS) {
      expect(html).toContain(name);
      expect(html).toContain(description);
    }
    for (const { file, purpose } of DEVELOPER_FILES) {
      expect(html).toContain(`href="/developer/${file}"`);
      expect(html).toContain(purpose);
      expect(existsSync(join(root, "public/developer", file)), file).toBe(true);
    }
  });

  it("prints every first-request sample character for character, and the operation it calls", () => {
    for (const snippet of FIRST_CALL_SNIPPETS) {
      expect(codeTokens(snippet.body).map((t) => t.text).join("")).toBe(snippet.body);
      for (const line of snippet.body.split("\n")) expect(shown).toContain(line);
    }
    expect(html).toContain(`GET /api/v1${FIRST_CALL_OPERATION.path}`);
    expect(html).toContain(FIRST_CALL_OPERATION.scope);
    expect(html).toContain(`<code class="`);
    expect(html).toContain(FIRST_CALL_OPERATION.mcpTool);
  });

  it("prints every file of the signed package with its purpose", () => {
    for (const [path, purpose] of PACKAGE_CONTENTS) {
      expect(html).toContain(path);
      expect(html).toContain(purpose);
    }
  });

  it("keeps the two developer events on the downloads that carried them", () => {
    const source = readFileSync(join(dir, "developers.tsx"), "utf8");
    expect(source).toContain('event="developer_mcp_started"');
    expect(source).toContain('event="developer_api_started"');
  });
});

describe("code samples", () => {
  it("scroll inside a named, focusable region on a dark surface", () => {
    expect(html.match(/role="region"/g)!.length).toBeGreaterThanOrEqual(FIRST_CALL_SNIPPETS.length);
    const block = code.find((f) => f.file.endsWith("code-block.tsx"))!.text;
    expect(block).toContain('role="region"');
    expect(block).toContain("tabIndex={0}");
    const sheet = styles.find((f) => f.file.endsWith("code-block.module.css"))!.text;
    expect(sheet).toMatch(/\.region\s*\{[^}]*overflow-x:\s*auto/);
    expect(sheet).toMatch(/\.region\s*\{[^}]*background:\s*var\(--v34-forest\)/);
  });
});

describe("copy", () => {
  it("drops what the register row removes", () => {
    for (const word of [/\bSDK\b/, /Action API/i, /idempotency/i, /replayable/i, /No enumeration/i, /\bKQU\b/]) {
      expect(html).not.toMatch(word);
    }
    for (const bad of ["search", "fetch", "ask", "export", "actions"]) {
      expect(html, bad).not.toMatch(new RegExp(`<code[^>]*>${bad}</code>`));
    }
  });

  it("keeps the statements the legacy page sourced", () => {
    expect(html).toContain("Always the current active revision");
    expect(html).toContain("Creating, rotating and revoking a key each write an audit row");
    expect(html).toContain("OpenAPI contract");
  });

  it("states what things are, with no defensive disclaimer", () => {
    const content = code.find((f) => f.file.endsWith("developers-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });

  it("shows the access gate only while the deployment's own policy keeps it closed", () => {
    const gate = "Connecting your own sources is arranged with us.";
    if (activationPolicy.customerData.enabled) expect(html).not.toContain(gate);
    else expect(html).toContain(gate);
  });
});

describe("links", () => {
  const allowed = ["/docs/quickstart", "/api", "/docs", "/docs/use-with-ai", "/status", "/workspace", "/explore", "/api/openapi", "/developer/channel.json", "/developer/README.md", "/developer"];

  it("types no path except the retained pages and the published files it names", () => {
    for (const f of code) {
      for (const [literal] of f.text.matchAll(/["'`]\/[a-z][^"'`$]*/g)) {
        expect(allowed, `${f.file}: ${literal}`).toContain(literal.slice(1));
      }
    }
  });

  it("links only to live registry routes or to retained pages that exist", () => {
    expect(DEVELOPERS_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of DEVELOPERS_DESTINATIONS) {
      const route = v34RouteByPath(path);
      if (route) expect(route.release, `${path} is held`).toBe("live");
      else {
        const page = existsSync(join(root, "app", path, "page.tsx"));
        const docsSection = /^\/docs\/[\w-]+$/.test(path) && existsSync(join(root, "app", "docs", "[section]", "page.tsx"));
        expect(page || docsSection, `${path} has no page`).toBe(true);
      }
    }
  });

  it("does not link a held route from this live page", () => {
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const route = v34RouteByPath(href!);
      if (route) expect(route.release, `${href} is held`).toBe("live");
    }
  });

  it("keeps the key-management entry in the workspace and the docs links", () => {
    for (const href of ["/workspace", "/docs", "/docs/use-with-ai", "/status", "/api", "/docs/quickstart"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
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
