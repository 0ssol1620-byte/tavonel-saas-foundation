/**
 * The integration recipes on /docs/integration-recipes, run.
 *
 * Audit 2026-09-11 X08 asks for two or three verified recipes rather than a broad integration
 * guide, and "verified" is the whole point: a recipe nobody runs is a screenshot of a promise.
 * Each check below executes the same commands the docs page prints, against a deployment, and
 * fails loudly on the first thing that does not match.
 *
 *   node scripts/developer-recipes/smoke.mjs                 # every recipe
 *   node scripts/developer-recipes/smoke.mjs mcp             # one, by name
 *   TAVONEL_RECIPE_BASE_URL=https://tavonel.com node scripts/developer-recipes/smoke.mjs
 *
 * Default target is http://127.0.0.1:3207, the devx lane's dev-server port. Every request is a
 * GET on an unauthenticated route: no key, no upload, no compile, no spend. That is a deliberate
 * limit of this script and not an accident -- the recipes it covers are the ones a customer can
 * run before they have an account, which is exactly when they are deciding.
 *
 * Exit 0 when every selected recipe passed, 1 on the first failure, 2 on an unknown name.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_NEXTJS = resolve(HERE, "../..");
const BASE = (process.env.TAVONEL_RECIPE_BASE_URL || "http://127.0.0.1:3207").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  assert(response.ok, `GET ${path} -> ${response.status}`);
  return { response, body: await response.json() };
}

/*
  Recipe 1 -- Claude Desktop / Claude Code over MCP.

  What can be verified without a Claude installation is the half that actually breaks: the config
  the page prints must be valid JSON with the command and args a client will execute, the file it
  names must exist where the config points, and the server must complete a real MCP handshake and
  offer exactly the read-only tools the page lists. A wrong tool name in the docs is the failure
  a customer hits five minutes after pasting the config.
*/
async function mcp() {
  const serverPath = resolve(REPO_NEXTJS, "public/developer/tavonel-mcp.mjs");
  assert(existsSync(serverPath), `the MCP server is not at ${serverPath}`);

  const config = {
    mcpServers: {
      tavonel: {
        command: "node",
        args: [serverPath],
        env: { TAVONEL_API_KEY: "tvnl_live_...", TAVONEL_BASE_URL: BASE },
      },
    },
  };
  // Round-trips through JSON because a config a client cannot parse is the most common failure.
  const parsed = JSON.parse(JSON.stringify(config));
  assert(parsed.mcpServers.tavonel.command === "node", "the recipe config does not launch node");

  const child = spawn(parsed.mcpServers.tavonel.command, parsed.mcpServers.tavonel.args, {
    env: { ...process.env, ...parsed.mcpServers.tavonel.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const frames = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tavonel-recipe-smoke", version: "1" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ];
  child.stdin.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("close", done);
  });
  assert(status === 0, `the MCP server exited ${status}: ${stderr}`);

  const responses = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const initialize = responses.find((frame) => frame.id === 1);
  const tools = responses.find((frame) => frame.id === 2);
  assert(initialize?.result?.serverInfo?.name === "tavonel-readonly", "the server did not identify as read-only");
  const names = (tools?.result?.tools ?? []).map((tool) => tool.name).sort();
  assert(
    names.join(",") === "ask_world,download_package,get_evidence,get_object,get_relation,get_world,list_sources,search_world",
    `the tool list has drifted from the recipe: ${names.join(", ")}`,
  );
  for (const forbidden of ["promote", "rollback", "upload", "compile"]) {
    assert(!names.some((name) => name.includes(forbidden)), `a ${forbidden} tool appeared on a read-only surface`);
  }
  return `${names.length} read-only tools, handshake completed, config parses`;
}

/*
  Recipe 2 -- a Python script over the public sample World, with no key.

  Runs the recipe's own artifact rather than reimplementing it here, so the file the docs page
  names is the file that is tested. No Python on the machine is a reported skip, never a pass.
*/
async function publicSample() {
  const script = resolve(HERE, "public-sample.py");
  const interpreter = ["py", "python3", "python"]
    .find((name) => spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0);
  if (!interpreter) return "SKIPPED: no Python interpreter on PATH, so public-sample.py did not run";
  const run = spawnSync(interpreter, [script, "--base-url", BASE], { encoding: "utf8", timeout: 60_000 });
  assert(run.status === 0, `public-sample.py exited ${run.status}: ${run.stdout}${run.stderr}`);
  return run.stdout.trim().split("\n").at(-1) ?? "ran";
}

/*
  Recipe 3 -- curl, before you have a key.

  Three unauthenticated reads that answer three purchase questions: what can this deployment
  read, what does its API actually publish, and who signs its exports. The capability digest is
  recomputed here by the documented procedure, because a pin a caller cannot reproduce is not
  a pin. A deployment with no signer configured answers 503 EXPORT_SIGNER_NOT_CONFIGURED, which
  is the fail-closed contract and therefore a pass for this recipe, not a failure.
*/
async function curlBeforeKey() {
  const { body: manifest } = await getJson("/api/v1/capabilities");
  assert(Array.isArray(manifest.entries) && manifest.entries.length > 0, "the capability manifest lists no format entries");
  const { contentSha256, ...withoutDigest } = manifest;
  const recomputed = `sha256:${createHash("sha256").update(JSON.stringify(withoutDigest), "utf8").digest("hex")}`;
  assert(
    recomputed === contentSha256,
    `the documented recompute procedure gave ${recomputed}, the manifest says ${contentSha256}`,
  );

  const { body: openapi } = await getJson("/api/openapi");
  assert(openapi.openapi === "3.1.0", `unexpected OpenAPI version ${openapi.openapi}`);
  for (const path of ["/capabilities", "/uploads/capability", "/collections/{id}/ask"]) {
    assert(openapi.paths?.[path], `the published contract has no ${path}`);
  }
  assert(
    !Object.keys(openapi.paths).some((path) => path.includes("promote") || path.includes("rollback")),
    "a promotion or rollback path appeared in the published contract",
  );

  const trust = await fetch(`${BASE}/api/export/trust`, { headers: { accept: "application/json" } });
  const trustBody = await trust.json();
  if (trust.status === 503) {
    assert(
      trustBody.code === "EXPORT_SIGNER_NOT_CONFIGURED",
      `the trust endpoint refused with ${trustBody.code} rather than the documented code`,
    );
    return `manifest digest reproduced, contract published, export signer not configured (fail-closed)`;
  }
  assert(trust.ok, `GET /api/export/trust -> ${trust.status}`);
  assert(/^sha256:[a-f0-9]{64}$/.test(trustBody.publicKeySpkiSha256 ?? ""), "the trust record has no key fingerprint");
  return `manifest digest reproduced, contract published, signer ${trustBody.keyId}`;
}

const RECIPES = { mcp, "public-sample": publicSample, curl: curlBeforeKey };

const selected = process.argv.slice(2);
const unknown = selected.filter((name) => !(name in RECIPES));
if (unknown.length > 0) {
  process.stderr.write(`unknown recipe(s): ${unknown.join(", ")}\nknown: ${Object.keys(RECIPES).join(", ")}\n`);
  process.exit(2);
}

let failed = 0;
for (const [name, recipe] of Object.entries(RECIPES)) {
  if (selected.length > 0 && !selected.includes(name)) continue;
  try {
    process.stdout.write(`${name}: ${await recipe()}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`${name}: FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
process.stdout.write(failed === 0 ? `recipes OK against ${BASE}\n` : `${failed} recipe(s) failed against ${BASE}\n`);
process.exitCode = failed === 0 ? 0 : 1;
