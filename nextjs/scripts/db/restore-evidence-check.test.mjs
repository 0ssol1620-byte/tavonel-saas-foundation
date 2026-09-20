import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { RestoreEvidenceInputError, normalizeRestoreReceipt, validateRestoreReceipt } from "./restore-evidence-check.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tavonel-b11-"));
  const write = (name, content) => {
    const bytes = Buffer.from(content);
    writeFileSync(join(directory, name), bytes);
    return { path: name, sizeBytes: bytes.byteLength, sha256: digest(bytes) };
  };
  const receiptPath = join(directory, "receipt.json");
  const value = {
    schemaVersion: "tavonel.restore_evidence.v1", drillId: "b11-test", backupId: "backup-001", operatorId: "operator-test",
    startedAt: "2026-09-20T00:00:00Z", completedAt: "2026-09-20T00:05:00Z",
    environment: {
      kind: "isolated-non-production", destinationId: "ephemeral-test", cleanProvisioning: true,
      productionConnectionUsed: false, outboundCustomerNotificationsDisabled: true,
      provisioningEvidence: write("provisioning.json", '{"fresh":true}\n'),
    },
    source: { expected: write("source-a.bin", "source-v1"), restored: write("source-b.bin", "source-v1") },
    schemaIdentity: { expected: write("schema-a.json", '{"schema":"v1"}\n'), restored: write("schema-b.json", '{"schema":"v1"}\n') },
    dataIdentity: { expected: write("data-a.json", '{"rows":7}\n'), restored: write("data-b.json", '{"rows":7}\n') },
    representativeQuery: {
      queryId: "source-binding", statement: write("query.sql", "select id from items order by id;\n"),
      result: { expected: write("query-a.json", '[{"id":1}]\n'), restored: write("query-b.json", '[{"id":1}]\n') },
    },
    signedExport: { archive: write("export.zip", "test archive"), trustedFingerprint: `sha256:${"a".repeat(64)}` },
    cleanup: { completed: true, completedAt: "2026-09-20T00:06:00Z", evidence: write("cleanup.json", '{"removed":true}\n') },
  };
  return { directory, receiptPath, value };
}

test("complete matching evidence passes after signed export verification", async () => {
  const { receiptPath, value } = fixture();
  const report = await validateRestoreReceipt(normalizeRestoreReceipt(value, receiptPath), { verifySignedExport: () => ({ ok: true }) });
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.reasons, []);
});

test("source, schema, data, and query mismatches fail closed", async () => {
  const { receiptPath, value } = fixture();
  value.source.restored.sha256 = "b".repeat(64);
  value.schemaIdentity.restored.sha256 = "c".repeat(64);
  value.dataIdentity.restored.sizeBytes += 1;
  value.representativeQuery.result.restored.sha256 = "d".repeat(64);
  const report = await validateRestoreReceipt(normalizeRestoreReceipt(value, receiptPath), { verifySignedExport: () => ({ ok: true }) });
  assert.equal(report.status, "FAIL");
  for (const reason of ["SOURCE_IDENTITY_MISMATCH", "SCHEMA_IDENTITY_MISMATCH", "DATA_IDENTITY_MISMATCH", "REPRESENTATIVE_QUERY_RESULT_MISMATCH"]) {
    assert.ok(report.reasons.includes(reason));
  }
});

test("signed export verifier failure is a hard failure", async () => {
  const { receiptPath, value } = fixture();
  const report = await validateRestoreReceipt(normalizeRestoreReceipt(value, receiptPath), { verifySignedExport: () => ({ ok: false }) });
  assert.deepEqual(report.reasons, ["SIGNED_EXPORT_VERIFICATION_FAILED"]);
});

test("default verifier rejects an unsigned archive", async () => {
  const { receiptPath, value } = fixture();
  const report = await validateRestoreReceipt(normalizeRestoreReceipt(value, receiptPath));
  assert.equal(report.status, "FAIL");
  assert.equal(report.checks.signedExport, false);
  assert.ok(report.reasons.includes("SIGNED_EXPORT_VERIFICATION_FAILED"));
});

test("clean-environment omissions and production use are rejected", () => {
  const first = fixture();
  delete first.value.environment.provisioningEvidence;
  assert.throws(() => normalizeRestoreReceipt(first.value, first.receiptPath), RestoreEvidenceInputError);
  const second = fixture();
  second.value.environment.productionConnectionUsed = true;
  assert.throws(() => normalizeRestoreReceipt(second.value, second.receiptPath), /must be false/);
});

test("absolute, URL, and traversal artifact paths are rejected", () => {
  for (const path of ["C:\\secret\\source.bin", "https://example.test/evidence", "../outside.json"]) {
    const { receiptPath, value } = fixture();
    value.source.expected.path = path;
    assert.throws(() => normalizeRestoreReceipt(value, receiptPath), /path/);
  }
});

test("CLI rejects an incomplete receipt with exit 2", () => {
  const { directory } = fixture();
  const receipt = join(directory, "incomplete.json");
  writeFileSync(receipt, JSON.stringify({ schemaVersion: "tavonel.restore_evidence.v1" }), "utf8");
  const result = spawnSync(process.execPath, [join(import.meta.dirname, "restore-evidence-check.mjs"), "--receipt", receipt], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /restore evidence input error/);
});
