import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { h1Text, typedCounts } from "./route-test-support";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { OAUTH_CONNECTOR_PROVIDERS } from "@/lib/connector-oauth";
import { FIRST_CALL_SNIPPETS } from "@/lib/developer-snippets";
import { MCP_TOOLS, MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { ConnectBody } from "@/components/v34/routes/connect/connect";
import {
  CONNECT_DESTINATIONS, EXPLORE_HREF, MCP_DOCS_HREF, WORKSPACE_HREF,
} from "@/components/v34/routes/connect/connect-content";
import { CONNECTORS } from "@/components/v34/routes/connect/connect-sources";
import { V34_ROUTE_KEYS, v34RouteByPath } from "./routes";

/*
  Source-level guards for the /connect route (components/v34/routes/connect/** and
  app/connect/page.tsx), plus a server render in both states of the remote endpoint. Followed from
  home-page.test.ts.
*/

const KEY = "connect";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "components/v34/routes", KEY);

const files = readdirSync(dir).map((name) => ({ file: relative(root, join(dir, name)).replaceAll("\\", "/"), text: readFileSync(join(dir, name), "utf8") }));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const code = files.filter((f) => /\.tsx?$/.test(f.file)).map((f) => ({ ...f, text: stripComments(f.text) }));
const styles = files.filter((f) => f.file.endsWith(".css")).map((f) => ({ ...f, text: stripComments(f.text) }));
const text = code.map((f) => f.text).join("\n");
const render = (remoteOpen: boolean) => renderToStaticMarkup(createElement(ConnectBody, { remoteOpen }));
const plain = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const textOf = (html: string) => plain(html.replace(/<[^>]+>/g, ""));
const open = plain(render(true));
const closed = plain(render(false));
const page = stripComments(readFileSync(join(root, "app", KEY, "page.tsx"), "utf8"));
const channel = JSON.parse(readFileSync(join(root, "public/developer/channel.json"), "utf8")) as { minimumPython: string };

describe("connect page", () => {
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
    for (const html of [open, closed]) {
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(h1Text(html)).toBe("Connect a World to your AI client over MCP");
    }
  });
});

describe("computed, not typed", () => {
  it("types no price, plan or tool name", () => {
    expect(text).not.toMatch(/[$€£₩]\s?\d/);
    for (const offer of Object.values(BILLING_OFFERS)) expect(text, offer.label).not.toMatch(new RegExp(`\\b${offer.label}\\b`));
    for (const [name] of MCP_TOOLS) expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`));
  });

  it("types no figure in its copy", () => {
    const copy = code.find((f) => f.file.endsWith("connect-content.ts"))!.text;
    for (const pattern of [/\b\d{1,3}(?:,\d{3})+\b/, /\b\d+\.\d+\b/, /\b\d{2,}\b/, /\d\s?%/]) expect(copy).not.toMatch(pattern);
  });

  it("reads the tool count and the tools from lib/mcp-tools.ts", () => {
    expect(open).toContain(`The same ${MCP_TOOL_COUNT_WORD} read-only tools`);
    for (const [name, description] of MCP_TOOLS) {
      expect(open).toContain(name);
      expect(open).toContain(description);
    }
  });

  it("prints the stdio config from the first-call samples", () => {
    const config = FIRST_CALL_SNIPPETS.find((entry) => entry.label === "MCP")!.body;
    const shown = textOf(render(true));
    for (const line of config.split("\n")) expect(shown).toContain(line);
  });

  it("has a row for every OAuth provider the product connects to, and no other", () => {
    expect(CONNECTORS.map((c) => c.provider).sort()).toEqual([...OAUTH_CONNECTOR_PROVIDERS].sort());
    for (const connector of CONNECTORS) expect(open).toContain(connector.name);
  });

  it("states the agent's minimum Python as the distribution record does", () => {
    const sources = files.find((f) => f.file.endsWith("connect-sources.ts"))!.text;
    expect(sources).toContain(`Python ${channel.minimumPython} or newer`);
  });
});

describe("remote endpoint state", () => {
  it("is Available when the endpoint is open and Closed on this site when it is not", () => {
    expect(open).toContain(">Available</td>");
    expect(open).not.toContain("Closed on this site");
    expect(closed).toContain("Closed on this site");
    // Local server is always Available; the remote row and every by-URL cell follow the switch.
    expect(closed.match(/Closed on this site/g)!.length).toBeGreaterThan(1);
  });

  it("shows by-URL setup only while the endpoint is open", () => {
    expect(open).toContain("Add custom connector");
    expect(closed).not.toContain("Add custom connector");
  });
});

describe("copy", () => {
  it("labels the client steps as configuration steps and names no listing or directory", () => {
    expect(open).toContain("Configuration steps");
    for (const word of [/approved listing/i, /\bdirectory listing\b/i, /\bKQU\b/, /\bSDK\b/, /Codex/, /ChatGPT/, /Host documentation checked/i]) {
      expect(open).not.toMatch(word);
    }
  });

  it("states what things are, with no defensive disclaimer in the page copy", () => {
    // The connector and agent answers (connect-sources.ts) are operating facts a security reviewer
    // reads, such as what happens at a deletion; the page copy is held to the rule.
    const content = code.find((f) => f.file.endsWith("connect-content.ts"))!;
    expect(content.text).not.toMatch(/\b(?:not|never|no longer)\b|n't\b/i);
  });

  it("shows the access gate only while the deployment's own policy keeps it closed", () => {
    const gate = "Connecting your own sources is arranged with us.";
    if (activationPolicy.customerData.enabled) expect(open).not.toContain(gate);
    else expect(open).toContain(gate);
  });
});

describe("links", () => {
  const allowed = ["/docs/mcp", "/workspace", "/explore", "/developer/tavonel-mcp.mjs", "/developer/channel.json", "/developer/tavonel-source-agent.py", "/developer/source-agent-operations.md"];

  it("types no path except the retained pages and the published files it names", () => {
    for (const f of code) {
      for (const [literal] of f.text.matchAll(/["'`]\/[a-z][^"'`$]*/g)) {
        const path = literal.slice(1);
        // Prose that names a file or a command is not a link.
        if (/\s/.test(path) || path.startsWith("/mcp") || path.startsWith("/developer/channel.json at")) continue;
        expect(allowed, `${f.file}: ${literal}`).toContain(path);
      }
    }
  });

  it("links only to live registry routes, to retained pages that exist, or to published files", () => {
    expect(CONNECT_DESTINATIONS.length).toBeGreaterThan(0);
    for (const path of CONNECT_DESTINATIONS) {
      const route = v34RouteByPath(path);
      if (route) expect(route.release, `${path} is held`).toBe("live");
      else {
        const page = existsSync(join(root, "app", path, "page.tsx"));
        const docsSection = /^\/docs\/[\w-]+$/.test(path) && existsSync(join(root, "app", "docs", "[section]", "page.tsx"));
        expect(page || docsSection, `${path} has no page`).toBe(true);
      }
    }
    expect(existsSync(join(root, "app", "docs", "[section]", "page.tsx"))).toBe(true);
    expect(MCP_DOCS_HREF).toBe("/docs/mcp");
    for (const file of ["tavonel-mcp.mjs", "channel.json", "tavonel-source-agent.py", "source-agent-operations.md"]) {
      expect(existsSync(join(root, "public/developer", file)), file).toBe(true);
    }
    expect(open).toContain(`href="${WORKSPACE_HREF}"`);
    expect(EXPLORE_HREF).toBe("/explore");
  });

  it("does not link a held route from this live page", () => {
    for (const [, href] of open.matchAll(/href="(\/[^"#?]*)"/g)) {
      const route = v34RouteByPath(href!);
      if (route) expect(route.release, `${href} is held`).toBe("live");
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

describe("typed counts", () => {
  it("types no number word or digits before a counted noun", () => {
    expect(typedCounts("connect")).toEqual([]);
  });
});
