import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { READ_ONLY_MCP_DIRECTORIES, READ_ONLY_MCP_FILES, readOnlyMcpViolations } from "../scripts/agent-mcp-isolation.mjs";

const NEXTJS = resolve(import.meta.dirname, "..");

describe("readOnlyMcpViolations (I-18 tripwire)", () => {
  it.each([
    "nextjs/public/developer/tavonel-mcp.mjs",
    "nextjs/app/api/mcp/route.ts",
    "nextjs/app/api/mcp/oauth/token/route.ts",
    "nextjs/lib/remote-mcp.ts",
    "nextjs/lib/remote-mcp-dispatch.ts",
    "nextjs/lib/remote-mcp-facade.ts",
    "nextjs/app/.well-known/oauth-protected-resource/route.ts",
    "nextjs/app/oauth/authorize/page.tsx",
    "nextjs/components/workspace/connect-ai-panel.tsx",
  ])("flags %s", (path) => {
    expect(readOnlyMcpViolations([path])).toEqual([path]);
  });

  it("flags a path written with backslashes or a leading ./", () => {
    expect(readOnlyMcpViolations(["nextjs\\lib\\remote-mcp.ts", "./nextjs/app/api/mcp/route.ts"]))
      .toEqual(["nextjs/lib/remote-mcp.ts", "nextjs/app/api/mcp/route.ts"]);
  });

  it.each([
    "nextjs/lib/agent-access.ts",
    "nextjs/lib/agent-consent.ts",
    "nextjs/scripts/agent-mcp-isolation.mjs",
    "nextjs/app/api/agent-mcp/route.ts",
    "nextjs/lib/remote-mcp.test.ts",
    "nextjs/lib/remote-mcp-dispatch.test.ts",
    "nextjs/app/api/mcpx/route.ts",
    "supabase/migrations/20261117130000_agent_proposals.sql",
    "docs/adr/0009-agent-proposals.md",
  ])("does not flag %s", (path) => {
    expect(readOnlyMcpViolations([path])).toEqual([]);
  });

  it("returns every violation of a mixed list, in order", () => {
    expect(readOnlyMcpViolations(["nextjs/lib/agent-access.ts", "nextjs/app/oauth/x.ts", "README.md", "nextjs/lib/remote-mcp.ts"]))
      .toEqual(["nextjs/app/oauth/x.ts", "nextjs/lib/remote-mcp.ts"]);
  });

  it("names paths that exist in this tree, so a rename cannot silently empty the list", () => {
    for (const file of READ_ONLY_MCP_FILES) expect(statSync(resolve(NEXTJS, "..", file)).isFile(), file).toBe(true);
    for (const dir of READ_ONLY_MCP_DIRECTORIES) expect(statSync(resolve(NEXTJS, "..", dir)).isDirectory(), dir).toBe(true);
  });
});

/** Every source file below `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}
// Every way a module names another by string: `from "x"` (import and re-export), a bare side-effect
// `import "x"`, a dynamic `import("x")` and `require("x")`.
const IMPORTS_AGENT_MODULE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'][^"']*\/lib\/agent-[^"']*["']/;

describe("the read-only MCP route imports no agent module (source test)", () => {
  it("finds the read-only MCP route files", () => {
    expect(filesUnder(resolve(NEXTJS, "app/api/mcp")).length).toBeGreaterThan(0);
  });

  /*
    WO-AGENT-OAUTH-1 (FOUNDER-DECISIONS-20261127 §C, "shared TAVONEL OAuth issuer + separate protected resource"):
    the issuer's authorize and token routes hand a request naming the agent resource to lib/agent-oauth.ts, and
    import that one module and nothing else of the agent's. Every other file under app/api/mcp -- the read-only
    MCP endpoint itself, registration -- still imports no agent module, and lib/remote-mcp.ts imports none either.
  */
  const ISSUER_ROUTES = new Set(["app/api/mcp/oauth/authorize/route.ts", "app/api/mcp/oauth/token/route.ts"]);
  // Every agent-module reference in a file, across lines (the pattern's \s* spans a newline), not line by line.
  const agentImports = (source: string) => [...source.matchAll(new RegExp(IMPORTS_AGENT_MODULE.source, "g"))].map((match) => match[0]);
  const AGENT_OAUTH_SPECIFIER = /^from\s*"@\/lib\/agent-oauth"$/;

  it("no file under app/api/mcp but the issuer's two routes imports lib/agent-* (whole-file check, as before)", () => {
    const offenders = filesUnder(resolve(NEXTJS, "app/api/mcp"))
      .filter((file) => !ISSUER_ROUTES.has(relative(NEXTJS, file).replaceAll("\\", "/")))
      .filter((file) => IMPORTS_AGENT_MODULE.test(readFileSync(file, "utf8")))
      .map((file) => relative(NEXTJS, file));
    expect(offenders).toEqual([]);
  });

  it("the read-only MCP endpoint and its library modules import no agent module at all", () => {
    for (const file of ["app/api/mcp/route.ts", "lib/remote-mcp.ts", "lib/remote-mcp-dispatch.ts", "lib/remote-mcp-facade.ts"]) {
      expect(IMPORTS_AGENT_MODULE.test(readFileSync(resolve(NEXTJS, file), "utf8")), file).toBe(false);
    }
  });

  it("the issuer's two routes reference exactly one agent module, lib/agent-oauth, once each (whole file, any line split)", () => {
    for (const path of ISSUER_ROUTES) {
      const found = agentImports(readFileSync(resolve(NEXTJS, path), "utf8"));
      expect(found.length, path).toBe(1);
      expect(AGENT_OAUTH_SPECIFIER.test(found[0]!), path).toBe(true);
    }
  });

  it("the whole-file matcher sees an import whose specifier sits on the next line", () => {
    expect(agentImports('import { x } from\n  "@/lib/agent-access";\nimport { y } from "@/lib/agent-oauth";')).toHaveLength(2);
  });

  it("the import pattern catches each import form", () => {
    for (const line of [
      'import { AGENT_SCOPES } from "@/lib/agent-access";',
      "import x from '../../../lib/agent-consent';",
      'const m = await import("@/lib/agent-mcp-dispatch");',
      'const m = require("../../lib/agent-access");',
      'export { AGENT_SCOPES } from "@/lib/agent-access";',
      'export * from "../../lib/agent-grants";',
    ]) expect(IMPORTS_AGENT_MODULE.test(line), line).toBe(true);
    expect(IMPORTS_AGENT_MODULE.test('import { x } from "@/lib/remote-mcp";')).toBe(false);
  });

  it("the import pattern catches a bare side-effect import (G5)", () => {
    for (const line of ['import "@/lib/agent-x";', "import '../../lib/agent-mcp-dispatch';", 'import"@/lib/agent-x";']) {
      expect(IMPORTS_AGENT_MODULE.test(line), line).toBe(true);
    }
    expect(IMPORTS_AGENT_MODULE.test('import "@/lib/remote-mcp";')).toBe(false);
    expect(IMPORTS_AGENT_MODULE.test('const reimport = "/lib/agent-x";')).toBe(false);
  });
});
