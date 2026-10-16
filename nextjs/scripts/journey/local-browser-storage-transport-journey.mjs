/** Actual headless Chromium + actual disposable SeaweedFS S3 through the browser storage transport; loopback only. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { withLocalStorage } from "./local-storage-journey.mjs";

const testFile = "scripts/journey/local-browser-storage-transport.integration.test.ts";
// Runtime locations for the browser, certificate tooling and disposable fixture directory only; never credentials.
const runtime = ["HOME", "LOCALAPPDATA", "PLAYWRIGHT_BROWSERS_PATH", "TAVONEL_LOCAL_POWERSHELL", "TAVONEL_LOCAL_S3_TMPDIR"];

export async function qualifyBrowserStorageTransport() {
  // withLocalStorage checksum-validates the executable before anything runs.
  return withLocalStorage(process.env.TAVONEL_LOCAL_SEAWEED_EXE, async storage => {
    const nextRoot = path.resolve(import.meta.dirname, "../..");
    const inherited = Object.fromEntries(runtime.filter(name => process.env[name]).map(name => [name, process.env[name]]));
    execFileSync(process.execPath, [path.join(nextRoot, "node_modules/vitest/vitest.mjs"), "run", testFile, "--config", "scripts/journey/vitest.local.config.ts"], {
      cwd: nextRoot, env: { ...inherited, ...storage.env, TAVONEL_LOCAL_S3_ENDPOINT: storage.endpoint },
      windowsHide: true, stdio: ["ignore", "inherit", "inherit"], timeout: 180_000,
    });
    const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");
    console.log(JSON.stringify({ kind: "real-browser-storage-transport", binarySha256: storage.binarySha256, service: "SeaweedFS 4.48",
      assertions: "Vitest output above", harnessSha256: sha256(import.meta.filename), testSha256: sha256(path.join(nextRoot, testFile)),
      cloudflareR2Verified: false, nextBrowserVerified: false }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await qualifyBrowserStorageTransport();
}
