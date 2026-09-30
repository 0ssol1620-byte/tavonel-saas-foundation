/** Real disposable SeaweedFS S3 qualification; never accepts a remote endpoint or existing data. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";

const executable = process.env.TAVONEL_LOCAL_SEAWEED_EXE;
assert.ok(executable, "Set TAVONEL_LOCAL_SEAWEED_EXE to the qualified official SeaweedFS 4.48 Windows binary");
const binarySha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
assert.equal(binarySha256, "394a0154424f3d96f7969c044b77ee4cfb649299f8b42ecc7b703971872ce61d");
const root = mkdtempSync(path.join(tmpdir(), "tavonel-s3-journey-"));
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
  "-admin.ui=false", "-webdav=false", "-s3.port.iceberg=0", "-s3.port.lance=0", "-volume.max=1", "-master.volumeSizeLimitMB=16",
  `-master.port=${master}`, `-master.port.grpc=${masterGrpc}`, `-volume.port=${volume}`, `-volume.port.grpc=${volumeGrpc}`,
  `-volume.port.public=${volumePublic}`, `-filer.port=${filer}`, `-filer.port.grpc=${filerGrpc}`, `-s3.port=${s3}`, `-s3.port.grpc=${s3Grpc}`,
  "-s3.externalUrl=https://00000000000000000000000000000000.r2.cloudflarestorage.com", `-bucket=${env.S3_BUCKET}`];
let diagnostics = "";
const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const closed = new Promise(resolve => child.once("close", resolve));
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
} finally {
  if (child.exitCode === null) child.kill();
  let timer;
  try {
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned SeaweedFS did not stop")), 10_000); })]);
  } finally { clearTimeout(timer); }
  rmSync(root, { recursive: true, force: true });
}
