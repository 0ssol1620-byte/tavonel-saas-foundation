#!/usr/bin/env node
/*
  The read-only MCP tripwire for agent-proposal work (workorders/agent-native.md §12 WO-AN-1, I-18).

    node scripts/agent-mcp-isolation.mjs <base-ref>

  Lists the files this branch changed since its merge-base with <base-ref> and fails when any of
  them is part of the read-only MCP. It judges this PR's own diff, never an absolute freeze: another
  work order may edit app/api/mcp legitimately, and its own PR is not judged by this script.
  Renames are listed as a delete and an add (--no-renames), so moving a read-MCP file away counts.

  Prints nothing and exits 0 when clean; prints each violating path and exits 1; exits 2 when git
  cannot answer (no silent pass).
*/
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Exact files of the read-only MCP. */
export const READ_ONLY_MCP_FILES = [
  "nextjs/public/developer/tavonel-mcp.mjs",
  "nextjs/lib/remote-mcp.ts",
  "nextjs/lib/remote-mcp-dispatch.ts",
  "nextjs/lib/remote-mcp-facade.ts",
  "nextjs/components/workspace/connect-ai-panel.tsx",
];
/** Directories of the read-only MCP: every file below them. */
export const READ_ONLY_MCP_DIRECTORIES = ["nextjs/app/api/mcp/", "nextjs/app/.well-known/", "nextjs/app/oauth/"];

/** The paths among `paths` (repository-relative, either slash) that belong to the read-only MCP. */
export function readOnlyMcpViolations(paths) {
  return paths
    .map((path) => path.trim().replaceAll("\\", "/").replace(/^\.\//, ""))
    .filter((path) => READ_ONLY_MCP_FILES.includes(path) || READ_ONLY_MCP_DIRECTORIES.some((dir) => path.startsWith(dir)));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function main(argv = process.argv.slice(2)) {
  const [base] = argv;
  if (!base || argv.length !== 1) {
    process.stderr.write("usage: node scripts/agent-mcp-isolation.mjs <base-ref>\n");
    return 2;
  }
  let changed;
  try {
    const mergeBase = git(["merge-base", "HEAD", base]).trim();
    changed = git(["-c", "core.quotepath=off", "diff", "--no-renames", "--name-only", `${mergeBase}...HEAD`]).split("\n").filter(Boolean);
  } catch (error) {
    process.stderr.write(`agent-mcp-isolation: git could not list the diff against ${base}: ${String(error.stderr ?? error.message).trim()}\n`);
    return 2;
  }
  const violations = readOnlyMcpViolations(changed);
  for (const path of violations) process.stdout.write(`${path}\n`);
  return violations.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
