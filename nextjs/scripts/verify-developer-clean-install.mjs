#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(root, "public", "developer");
const sandbox = mkdtempSync(join(tmpdir(), "tavonel-developer-clean-"));
const home = join(sandbox, "home");
const install = join(sandbox, "install");
mkdirSync(home);
mkdirSync(install);

const cleanEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  ComSpec: process.env.ComSpec,
  WINDIR: process.env.WINDIR,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: join(home, "AppData", "Local"),
  APPDATA: join(home, "AppData", "Roaming"),
  NO_PROXY: "127.0.0.1,localhost",
};

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: install, env: cleanEnv, input, encoding: "utf8", timeout: 15_000 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}

function pythonRuntime() {
  if (process.env.TAVONEL_VERIFY_PYTHON && existsSync(process.env.TAVONEL_VERIFY_PYTHON)) return process.env.TAVONEL_VERIFY_PYTHON;
  if (process.platform === "win32" && process.env.USERPROFILE) {
    const bundled = join(process.env.USERPROFILE, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
    if (existsSync(bundled)) return bundled;
  }
  return process.platform === "win32" ? "python" : "python3";
}

try {
  for (const name of ["tavonel-cli.mjs", "tavonel-mcp.mjs", "tavonel-source-agent.py", "channel.json", "README.md"]) cpSync(join(source, name), join(install, name));
  const cliVersion = run(process.execPath, ["tavonel-cli.mjs", "--version"]);
  const cliHelp = run(process.execPath, ["tavonel-cli.mjs", "help"]);
  const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "clean-harness", version: "1" } } });
  const mcp = JSON.parse(run(process.execPath, ["tavonel-mcp.mjs"], `${initialize}\n`));
  const python = pythonRuntime();
  const pythonVersion = run(python, ["--version"]);
  run(python, ["-I", "-m", "py_compile", "tavonel-source-agent.py"]);
  if (!cliVersion.includes("2026.8.30.1") || !cliHelp.includes("update-check")) throw new Error("CLI distribution contract failed");
  if (mcp?.result?.serverInfo?.version !== "2026.8.30.1") throw new Error("MCP distribution contract failed");
  process.stdout.write(`${JSON.stringify({ status: "passed", isolatedHome: true, providerSecretsInherited: false, cliVersion, mcpVersion: mcp.result.serverInfo.version, pythonVersion, sourceAgentSyntax: "passed" }, null, 2)}\n`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
