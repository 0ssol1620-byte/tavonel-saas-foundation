import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cdrRequestSignature, hmacSecretIsConfigured } from "./hmac";

const FIXTURE_SECRET = "foundation-cdr-hmac-fixture-secret-ok";
const TIMESTAMP = "2026-08-29T00:00:00.000Z";
const REQUEST_ID = "fixture-request-01";
const INPUT_SHA256 = `sha256:${"ab".repeat(32)}`;
const PYTHON_VECTOR = "MxeXyRr2ySRxi6yMWoyXE53csxdDqIgNB7fvPwdPpeM";

describe("cdrRequestSignature", () => {
  it("matches the Python unpadded base64url HMAC algorithm", async () => {
    const actual = await cdrRequestSignature(FIXTURE_SECRET, TIMESTAMP, REQUEST_ID, INPUT_SHA256);
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "expected_signature.py");
    let python = spawnSync("python", [script, FIXTURE_SECRET, TIMESTAMP, REQUEST_ID, INPUT_SHA256], {
      encoding: "utf8",
    });
    if (python.error && (python.error as NodeJS.ErrnoException).code === "ENOENT") {
      python = spawnSync("py", ["-3", script, FIXTURE_SECRET, TIMESTAMP, REQUEST_ID, INPUT_SHA256], {
        encoding: "utf8",
      });
    }
    assert.equal(python.status, 0, python.stderr);
    assert.equal(python.stdout.trim(), PYTHON_VECTOR);
    assert.equal(actual, PYTHON_VECTOR);
    assert.equal(actual.includes("="), false);
    assert.match(actual, /^[A-Za-z0-9_-]+$/);
  });

  it("treats the fixture secret as configured and short strings as missing", () => {
    assert.equal(hmacSecretIsConfigured(FIXTURE_SECRET), true);
    assert.equal(hmacSecretIsConfigured("too-short"), false);
    assert.equal(hmacSecretIsConfigured(""), false);
    assert.equal(hmacSecretIsConfigured(undefined), false);
  });
});
