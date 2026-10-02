/** Real disposable SeaweedFS S3 qualification; never accepts a remote endpoint or existing data. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { stopOwnedChild } from "./stop-owned-child.mjs";

const DIAGNOSTIC_TAIL_BYTES = 6000;
const DIAGNOSTIC_PRINT_LIMIT = 6144;

// Failure-only service tail. Literal secrets go first; a truncated tail drops its first partial line
// so a cut-off credential fragment cannot survive the literal match.
function redactedDiagnostics(text, env) {
  let out = text;
  if (out.length >= DIAGNOSTIC_TAIL_BYTES) {
    const newline = out.indexOf("\n");
    out = newline === -1 ? "" : out.slice(newline + 1);
  }
  for (const secret of [env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY]) if (secret) out = out.split(secret).join("[redacted]");
  return out
    .replace(/(AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)["']?\s*[=:]\s*["']?)[^\s"',&]+/gi, "$1[redacted]")
    .replace(/(authorization["']?\s*[=:]\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/((?:X-Amz-(?:Signature|Credential|Security-Token)|Signature|Credential)["']?\s*[=:]\s*["']?)[^\s"',&]+/gi, "$1[redacted]")
    .replace(/((?:secret|password|passwd|token|api[_-]?key|access[_-]?key)[\w-]*["']?\s*[=:]\s*["']?)[^\s"',&]+/gi, "$1[redacted]")
    .slice(-DIAGNOSTIC_PRINT_LIMIT);
}

/**
 * Parent for this harness's disposable directories. SeaweedFS refuses volume assignment below 1% free space on its
 * data directory, so TAVONEL_LOCAL_S3_TMPDIR (a non-secret path) may point at a roomier local disk. When set, it must
 * already be an absolute local directory: no UNC/network path, no link, nothing is created. Otherwise the OS tmpdir.
 */
export function localS3TempRoot() {
  const configured = process.env.TAVONEL_LOCAL_S3_TMPDIR;
  if (configured === undefined) return tmpdir();
  assert.ok(path.isAbsolute(configured) && !/^[\\/]{2}/.test(configured), "TAVONEL_LOCAL_S3_TMPDIR must be an absolute local path");
  assert.ok(lstatSync(configured, { throwIfNoEntry: false })?.isDirectory(), "TAVONEL_LOCAL_S3_TMPDIR must be an existing directory");
  return configured;
}

export async function withLocalStorage(executable, visit) {
assert.ok(executable, "Set TAVONEL_LOCAL_SEAWEED_EXE to the qualified official SeaweedFS 4.48 Windows binary");
const binarySha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
assert.ok(["win32", "linux"].includes(process.platform), "Only separately qualified Windows/Linux runtimes are supported");
assert.equal(binarySha256, process.platform === "win32"
  ? "394a0154424f3d96f7969c044b77ee4cfb649299f8b42ecc7b703971872ce61d"
  : "8c07a1ccc4ec058cd90989ac0533c30436832e41c63de2b26f37253d9f744c4d");
const root = mkdtempSync(path.join(localS3TempRoot(), "tavonel-s3-journey-"));
const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
env.GOMAXPROCS = "2";
env.AWS_ACCESS_KEY_ID = `synthetic-${randomBytes(12).toString("hex")}`;
env.AWS_SECRET_ACCESS_KEY = randomBytes(32).toString("hex");
env.S3_BUCKET = "tavonel-saas-foundation-quarantine";
const reservations = [];
const ports = [];
// Hold every port until all choices are made to avoid duplicates within this harness.
for (let i = 0; i < 9; i++) {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  reservations.push(server); ports.push(server.address().port);
}
await Promise.all(reservations.map(server => new Promise(resolve => server.close(resolve))));
const [master, masterGrpc, volume, volumeGrpc, filer, filerGrpc, s3, s3Grpc, volumePublic] = ports;
const args = ["mini", `-dir=${root}`, "-ip=127.0.0.1", "-ip.bind=127.0.0.1", "-master.telemetry=false",
  `-filer.localSocket=${path.join(root, "filer.sock")}`,
  "-admin.ui=false", "-webdav=false", "-s3.port.iceberg=0", "-s3.port.lance=0", "-volume.max=1", "-master.volumeSizeLimitMB=16",
  `-master.port=${master}`, `-master.port.grpc=${masterGrpc}`, `-volume.port=${volume}`, `-volume.port.grpc=${volumeGrpc}`,
  `-volume.port.public=${volumePublic}`, `-filer.port=${filer}`, `-filer.port.grpc=${filerGrpc}`, `-s3.port=${s3}`, `-s3.port.grpc=${s3Grpc}`,
  "-s3.externalUrl=https://00000000000000000000000000000000.r2.cloudflarestorage.com", `-bucket=${env.S3_BUCKET}`];
let diagnostics = "";
const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr]) stream.on("data", part => { diagnostics = (diagnostics + part).slice(-6000); });
child.on("error", error => { diagnostics += String(error); });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`SeaweedFS exited: ${diagnostics}`);
    try {
      const response = await fetch(`http://127.0.0.1:${s3}/${env.S3_BUCKET}`, { signal: AbortSignal.timeout(500) });
      await response.text();
      if (response.status === 403) { ready = true; break; }
    } catch { /* Fresh local service is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Authenticated local S3 did not start: ${diagnostics}`);
  if (visit) return await visit({ endpoint: `http://127.0.0.1:${s3}`, env, root, binarySha256 });
  const nextRoot = path.resolve(import.meta.dirname, "../..");
  const vitest = path.join(nextRoot, "node_modules/vitest/vitest.mjs");
  const output = execFileSync(process.execPath, [vitest, "run", "scripts/journey/local-storage.integration.test.ts", "--config", "scripts/journey/vitest.local.config.ts"], {
    cwd: nextRoot, env: { ...env, TAVONEL_LOCAL_S3_ENDPOINT: `http://127.0.0.1:${s3}` },
    windowsHide: true, encoding: "utf8", timeout: 90_000,
  });
  process.stdout.write(output);
  console.log(JSON.stringify({ kind: "real-disposable-s3", binarySha256, service: "SeaweedFS 4.48", assertions: "Vitest output above",
    harnessSha256: createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex"),
    foundationCommit: execFileSync("git", ["--git-dir", path.resolve(nextRoot, "../.git"), "rev-parse", "HEAD"], { cwd: nextRoot, encoding: "utf8", windowsHide: true }).trim(),
    cloudflareR2Verified: false, authLoginVerified: false, nextBrowserVerified: false }));
} catch (error) {
  // Record the original failure before cleanup can fail separately. Never log service credentials.
  console.error("Local service qualification failed:", error.name);
  console.error(`SeaweedFS output tail (redacted):\n${redactedDiagnostics(diagnostics, env)}`);
  throw error;
} finally {
  await stopOwnedChild(child);
  rmSync(root, { recursive: true, force: true });
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await withLocalStorage(process.env.TAVONEL_LOCAL_SEAWEED_EXE);
}
