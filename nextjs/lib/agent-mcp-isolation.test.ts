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
const IMPORTS_AGENT_MODULE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'][^"']*\/lib\/agent-[^"']*["']/;

describe("the read-only MCP route imports no agent module (source test)", () => {
  it("finds the read-only MCP route files", () => {
    expect(filesUnder(resolve(NEXTJS, "app/api/mcp")).length).toBeGreaterThan(0);
  });

  it("no file under app/api/mcp imports lib/agent-*", () => {
    const offenders = filesUnder(resolve(NEXTJS, "app/api/mcp"))
      .filter((file) => IMPORTS_AGENT_MODULE.test(readFileSync(file, "utf8")))
      .map((file) => relative(NEXTJS, file));
    expect(offenders).toEqual([]);
  });

  it("the import pattern catches each import form", () => {
    for (const line of [
      'import { AGENT_SCOPES } from "@/lib/agent-access";',
      "import x from '../../../lib/agent-consent';",
      'const m = await import("@/lib/agent-mcp-dispatch");',
      'const m = require("../../lib/agent-access");',
    ]) expect(IMPORTS_AGENT_MODULE.test(line), line).toBe(true);
    expect(IMPORTS_AGENT_MODULE.test('import { x } from "@/lib/remote-mcp";')).toBe(false);
  });
});
