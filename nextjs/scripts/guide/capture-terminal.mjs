// Guide videos: run a guide's terminal session for real and keep what it printed.
//
// Every command below is executed by Git Bash in a fresh, empty working directory, with every
// TAVONEL_* variable removed from the environment (no key exists in these sessions). stdout,
// stderr, exit code, start time and wall-clock duration are written to terminal/<session>.json
// (committed next to this file) exactly as captured. The replay page the recorder films is generated from that file and from
// nothing else, so no line of terminal output in the videos is typed by hand.
//
// usage: node nextjs/scripts/guide/capture-terminal.mjs <mcp|api>
//   GUIDE_WORK  scratch directory for the downloads and transcript (default: see terminal-replay.mjs)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GUIDE_WORK } from "./terminal-replay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASH = "C:/Program Files/Git/bin/bash.exe";

const INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"guide-recording","version":"1"}}}';
const INITIALIZED = '{"jsonrpc":"2.0","method":"notifications/initialized"}';
const LIST = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}';
const CALL = '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_worlds","arguments":{}}}';
const FILTER = String.raw`node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of s.trim().split("\n").map(l=>JSON.parse(l))){if(m.result&&m.result.serverInfo)console.log("initialize  "+m.result.serverInfo.name+" "+m.result.serverInfo.version);if(m.result&&m.result.tools)for(const t of m.result.tools)console.log("tool        "+t.name);if(m.result&&m.result.content)console.log("tools/call  isError="+m.result.isError+"  "+m.result.content.map(c=>c.text).join(" "));if(m.error)console.log("error       "+JSON.stringify(m.error))}})'`;
const pinCheck = (file, key) =>
  String.raw`test "sha256:$(sha256sum ${file} | cut -d' ' -f1)" = "$(node -p "require('./channel.json').assets.${key}.sha256")" && echo "match: ${file} = channel.json assets.${key}.sha256"`;

const SESSIONS = {
  mcp: [
    "curl -fsS https://tavonel.com/developer/channel.json -o channel.json",
    String.raw`grep -B1 -A3 '"mcp"' channel.json`,
    "curl -fsSO https://tavonel.com/developer/tavonel-mcp.mjs",
    "sha256sum tavonel-mcp.mjs",
    pinCheck("tavonel-mcp.mjs", "mcp"),
    "node tavonel-mcp.mjs --version",
    String.raw`env | grep '^TAVONEL_' || echo "no TAVONEL_ variable is set in this shell"`,
    String.raw`printf '%s\n' '` + `${INIT}' '${INITIALIZED}' '${LIST}' '${CALL}' > requests.jsonl`,
    "node tavonel-mcp.mjs < requests.jsonl",
    `node tavonel-mcp.mjs < requests.jsonl | ${FILTER}`,
    String.raw`node tavonel-mcp.mjs --doctor; echo "exit code $?"`,
  ],
  api: [
    "curl -sS -D headers.txt -o sample-world.json https://tavonel.com/reproducibility/sample-world",
    String.raw`grep -i '^content-digest' headers.txt`,
    String.raw`printf 'sha-256=:%s:\n' "$(openssl dgst -sha256 -binary sample-world.json | base64 -w0)"`,
    String.raw`test "$(grep -i '^content-digest' headers.txt | tr -d '\r' | cut -d' ' -f2)" = "sha-256=:$(openssl dgst -sha256 -binary sample-world.json | base64 -w0):" && echo "match: Content-Digest = sha-256 of the bytes received"`,
    "curl -fsS https://tavonel.com/developer/channel.json -o channel.json",
    "curl -fsSO https://tavonel.com/developer/tavonel-public-sample.py",
    pinCheck("tavonel-public-sample.py", "recipePublicSample"),
    "py -3.13 -I tavonel-public-sample.py",
    "curl -fsSO https://tavonel.com/developer/tavonel-cli.mjs",
    pinCheck("tavonel-cli.mjs", "cli"),
    "node tavonel-cli.mjs status",
  ],
};

const session = process.argv[2];
const commands = SESSIONS[session];
if (!commands) throw new Error("usage: node capture-terminal.mjs <mcp|api>");

// Downloads are untrusted data: each session gets its own new, empty directory.
const work = join(GUIDE_WORK, "terminal", `work-${session}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("TAVONEL_")));

const steps = [];
for (const command of commands) {
  const startedAt = new Date().toISOString();
  const t = performance.now();
  const r = spawnSync(BASH, ["-c", command], { cwd: work, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const ms = Math.round(performance.now() - t);
  steps.push({ command, startedAt, ms, exitCode: r.status, stdout: r.stdout, stderr: r.stderr });
  process.stderr.write(`[${r.status}] ${ms}ms  ${command.slice(0, 90)}\n`);
}

const capture = {
  schema: "tavonel.guide-terminal-capture.v1",
  session,
  capturedAt: steps[0].startedAt,
  shell: `${BASH} -c <command>`,
  node: process.version,
  environment: "fresh empty working directory; every TAVONEL_* variable removed; no API key",
  steps,
};
const body = `${JSON.stringify(capture, null, 2)}\n`;
writeFileSync(join(HERE, "terminal", `${session}.json`), body);
writeFileSync(
  join(GUIDE_WORK, "terminal", `${session}.transcript.txt`),
  steps.map((s) => `$ ${s.command}\n${s.stdout}${s.stderr}`).join(""),
);
console.log(`${session}.json sha256 ${createHash("sha256").update(body).digest("hex")}`);
