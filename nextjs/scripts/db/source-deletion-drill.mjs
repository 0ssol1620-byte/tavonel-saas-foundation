#!/usr/bin/env node
/**
 * Rehearse one complete source deletion, end to end, against a workspace the drill itself minted.
 *
 *   node --experimental-strip-types scripts/db/source-deletion-drill.mjs            # dry run
 *   node --experimental-strip-types scripts/db/source-deletion-drill.mjs --execute  # real deletes
 *
 * No deletion has ever executed anywhere in this system. Everything under
 * `supabase/migrations/20260920132000_*` and `20260921*` is IMPLEMENTED_NOT_PROVEN: the tests say
 * the code does what its author meant, and nothing says an object ever left R2. This script is
 * the thing that would change that, and the reason it is dry-run by default is that the change
 * it makes is irreversible.
 *
 * What it does NOT do, deliberately:
 *   - touch a customer workspace. It creates `pilot-drill<8 hex>` and refuses any other shape.
 *   - reimplement the workers. Attestation runs `runSourceDeletionInventoryAttestation` and the
 *     purge runs `runSourceDeletionSweep` -- the same code paths production would run, or the
 *     drill proves nothing about production.
 *   - assert a fact it did not observe. Storage emptiness comes from an independent re-listing
 *     after the sweep, not from the sweep's own count.
 *
 * The dry run drives the same `runSourceDeletionDrill` through an in-memory model of the R2 and
 * database contract, so the ordering, the refusals and the receipt are exercised offline. A model
 * is not the system: a green dry run says the drill is correct about what it intends to do, and
 * says nothing about what R2 and Postgres will actually answer.
 */
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { issueDeletionEvidence } from "../../lib/operations-p0.ts";
import { PROBE_WORKSPACE_PATTERN } from "../../lib/immutable-keys.ts";
import { datedReceiptPath, writeReceiptOnce } from "./evidence-receipt.mjs";
import { scanTextForSecrets } from "../secret-scan.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIRECTORY = resolve(SCRIPT_DIRECTORY, "../../../docs/evidence/production");

/** Every variable `--execute` requires. A missing one is a refusal, never a default. */
export const REQUIRED_EXECUTE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "TAVONEL_DRILL_OPERATOR",
  // enterprise_organizations.created_by is a real FK into auth.users. The drill cannot invent one
  // and will not reuse a customer's, so the operator names the account the drill acts as.
  "TAVONEL_DRILL_ACTOR_USER_ID",
  "TAVONEL_DRILL_BACKUP_EXPIRY",
  "TAVONEL_DRILL_CONFIRM",
];

export const EXECUTE_CONFIRMATION = "DELETE-PROBE-WORKSPACE-OBJECTS";

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

/**
 * The whole drill as data, before anything exists.
 *
 * Deriving the workspace key, the source id and the object keys up front is what lets the
 * verification step compare against something that was decided before the system was touched,
 * rather than against whatever the system happened to report back.
 */
export function planSourceDeletionDrill({ now = new Date(), nonce = randomUUID() } = {}) {
  const suffix = createHash("sha256").update(nonce).digest("hex").slice(0, 8);
  const workspaceKey = `pilot-drill${suffix}`;
  const documentIds = [0, 1].map((index) =>
    // A v4-shaped uuid derived from the nonce: stable across a resumed run, unique across runs.
    [
      createHash("sha256").update(`${nonce}:doc:${index}`).digest("hex").slice(0, 8),
      createHash("sha256").update(`${nonce}:doc:${index}`).digest("hex").slice(8, 12),
      `4${createHash("sha256").update(`${nonce}:doc:${index}`).digest("hex").slice(13, 16)}`,
      `8${createHash("sha256").update(`${nonce}:doc:${index}`).digest("hex").slice(17, 20)}`,
      createHash("sha256").update(`${nonce}:doc:${index}`).digest("hex").slice(20, 32),
    ].join("-"),
  );
  const bodies = documentIds.map((documentId, index) =>
    Buffer.from(`TAVONEL deletion drill probe ${index} for ${documentId}. Not customer data.\n`, "utf8"),
  );
  const derived = Buffer.from(
    `{"schemaVersion":"tavonel.drill_probe.v1","note":"synthetic derived artifact"}\n`,
    "utf8",
  );
  const objects = [
    ...documentIds.map((documentId, index) => ({
      key: `quarantine/${workspaceKey}/${documentId}/source`,
      body: bodies[index],
      sha256: sha256(bodies[index]),
      sizeBytes: bodies[index].length,
    })),
    {
      key: `immutable/${workspaceKey}/${workspaceKey}/${documentIds[0]}/${createHash("sha256")
        .update(bodies[0])
        .digest("hex")}/ocr.json`,
      body: derived,
      sha256: sha256(derived),
      sizeBytes: derived.length,
    },
    // Byte order, not locale order. The database canonicalizes the manifest with
    // `order by value->>'key'`, which is `text` collation-independent byte comparison for the
    // ASCII keys these drills produce; `localeCompare` can disagree with it (it folds case and
    // treats `-` as ignorable in some locales), and a plan sorted differently from the
    // attestation is a manifest digest mismatch that looks like tampering.
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    schemaVersion: "tavonel.source_deletion_drill.v1",
    startedAt: now.toISOString(),
    workspaceKey,
    organizationSlug: `deletion-drill-${suffix}`,
    sourceId: `src-${createHash("sha256").update(`${nonce}:source`).digest("hex")}`,
    oauthConnectionId: randomUUID(),
    provider: "google_drive",
    documentIds,
    objects,
  };
}

function step(name, ok, detail = {}) {
  return { step: name, ok, ...detail };
}

/**
 * Walks the plan through `ops`, stopping at the first thing that is not what it should be.
 *
 * `ops` is injected so the dry run, the unit tests and `--execute` drive identical control flow.
 * Every branch here fails closed: an unexpected status, a surviving object, an unpurged row and a
 * secret-shaped receipt each abort before the evidence file is written.
 */
export async function runSourceDeletionDrill(plan, ops, { maxSweepPasses = 32 } = {}) {
  const steps = [];
  const fail = (code, detail) => ({ ok: false, code, steps: [...steps, step(code, false, detail)] });

  if (!PROBE_WORKSPACE_PATTERN.test(plan.workspaceKey)) {
    return fail("DRILL_WORKSPACE_NOT_A_PROBE", { workspaceKey: plan.workspaceKey });
  }

  const existing = await ops.listWorkspaceObjects(plan.workspaceKey);
  if (!existing.ok) return fail("DRILL_PREFLIGHT_LIST_FAILED", { code: existing.code });
  if (existing.keys.length > 0) return fail("DRILL_WORKSPACE_NOT_EMPTY", { found: existing.keys.length });
  steps.push(step("preflight", true, { workspaceKey: plan.workspaceKey }));

  const provisioned = await ops.provision(plan);
  if (!provisioned.ok) return fail("DRILL_PROVISION_FAILED", { code: provisioned.code });
  steps.push(step("provision", true, { objects: plan.objects.length, documents: plan.documentIds.length }));

  // Eligibility must come from this workspace's own policy, read back rather than assumed. A
  // grace of anything but 0 means the drill would have to wait days, and waiting is not the thing
  // being rehearsed -- so it refuses instead of sleeping or, worse, editing someone's policy.
  const grace = await ops.graceDays(plan.workspaceKey);
  if (!grace.ok) return fail("DRILL_GRACE_READ_FAILED", { code: grace.code });
  if (grace.days !== 0) return fail("DRILL_GRACE_NOT_ZERO", { days: grace.days });
  steps.push(step("grace", true, { days: 0 }));

  const requested = await ops.requestDeletion(plan);
  if (!requested.ok) return fail("DRILL_REQUEST_FAILED", { code: requested.code });
  if (requested.status !== "recorded") return fail("DRILL_REQUEST_STATUS_UNEXPECTED", { status: requested.status });
  steps.push(step("request", true, { deletionId: requested.deletionId, eligibleAt: requested.eligibleAt }));

  const attested = await ops.attest();
  if (!attested.ok) return fail("DRILL_ATTESTATION_FAILED", { code: attested.code });
  if (attested.code !== "ATTESTED" || attested.status !== "recorded") {
    return fail("DRILL_ATTESTATION_UNEXPECTED", { code: attested.code, status: attested.status });
  }
  if (attested.artifactCount !== plan.objects.length) {
    return fail("DRILL_ATTESTATION_COUNT_MISMATCH", {
      attested: attested.artifactCount,
      planned: plan.objects.length,
    });
  }
  steps.push(step("attest", true, { artifactCount: attested.artifactCount }));

  let purged = 0;
  let passes = 0;
  for (; passes < maxSweepPasses; passes += 1) {
    const swept = await ops.sweepOnce();
    if (!swept.ok) return fail("DRILL_SWEEP_FAILED", { code: swept.code, pass: passes + 1 });
    purged += swept.receipts.length;
    if (swept.receipts.length === 0) break;
  }
  if (passes >= maxSweepPasses) return fail("DRILL_SWEEP_DID_NOT_SETTLE", { passes });
  if (purged !== plan.objects.length) {
    return fail("DRILL_SWEEP_COUNT_MISMATCH", { purged, planned: plan.objects.length });
  }
  const status = await ops.sweepStatus();
  if (!status.ok) return fail("DRILL_SWEEP_STATUS_FAILED", { code: status.code });
  if (status.inventoryIncomplete) return fail("DRILL_SWEEP_STATUS_INCOMPLETE", {});
  steps.push(step("sweep", true, { passes, purged }));

  // Independent of the sweep. The sweeper saying it deleted three objects and the bucket still
  // holding one is exactly the failure this drill exists to be able to detect.
  const remaining = await ops.listWorkspaceObjects(plan.workspaceKey);
  if (!remaining.ok) return fail("DRILL_VERIFY_LIST_FAILED", { code: remaining.code });
  if (remaining.keys.length > 0) return fail("DRILL_STORAGE_NOT_EMPTY", { remaining: remaining.keys.length });

  const rows = await ops.dbCounts(plan);
  if (!rows.ok) return fail("DRILL_VERIFY_ROWS_FAILED", { code: rows.code });
  if (
    rows.objects !== plan.objects.length ||
    rows.purged !== plan.objects.length ||
    rows.attestations !== 1 ||
    rows.purgeReceipts !== plan.objects.length ||
    rows.tombstoneReceipts !== 1
  ) {
    return fail("DRILL_ROW_STATE_UNEXPECTED", { ...rows, planned: plan.objects.length });
  }
  steps.push(step("verify", true, { storageEmpty: true, ...rows }));

  const backupExpiry = await ops.backupExpiry();
  if (!backupExpiry.ok || !UTC.test(backupExpiry.recordedAt ?? "")) {
    return fail("DRILL_BACKUP_EXPIRY_NOT_RECORDED", { code: backupExpiry.code });
  }

  const completedAt = (await ops.now()).toISOString();
  const evidence = issueDeletionEvidence({
    evidenceId: plan.evidenceId ?? randomUUID(),
    workspaceKey: plan.workspaceKey,
    requestedAt: plan.startedAt,
    completedAt,
    scope: "workspace",
    subjectId: plan.sourceId,
    deletedObjectCount: plan.objects.length,
    deletedRowCount: rows.purged,
    storageListingEmpty: true,
    databaseLookupEmpty: true,
    backupExpiryRecorded: true,
    auditDigest: sha256(
      JSON.stringify({
        deletionId: requested.deletionId,
        workspaceKey: plan.workspaceKey,
        sourceId: plan.sourceId,
        objects: plan.objects.map((object) => ({ key: object.key, sha256: object.sha256 })),
      }),
    ),
  });
  if (!evidence.ok) return fail("DRILL_EVIDENCE_REFUSED", { code: evidence.code });

  const receipt = {
    schemaVersion: "tavonel.source_deletion_drill.v1",
    drillId: requested.deletionId,
    operatorId: backupExpiry.operatorId,
    probeWorkspaceKey: plan.workspaceKey,
    sourceId: plan.sourceId,
    documentIds: plan.documentIds,
    objects: plan.objects.map((object) => ({
      key: object.key,
      sha256: object.sha256,
      sizeBytes: object.sizeBytes,
    })),
    sweepPasses: passes,
    databaseBackupExpiryRecordedAt: backupExpiry.recordedAt,
    evidence: evidence.evidence,
  };

  // The receipt names a workspace, three object keys and a digest, and it is about to be
  // committed to a public evidence folder. Scanning the serialized form is cheap and is the only
  // moment a leaked value can still be refused rather than published.
  const findings = scanTextForSecrets(JSON.stringify(receipt, null, 2), "deletion-drill-receipt");
  if (findings.length > 0) {
    return fail("DRILL_RECEIPT_SECRET_SUSPECTED", { findings: findings.map((f) => f.pattern) });
  }
  steps.push(step("evidence", true, { evidenceId: evidence.evidence.evidenceId }));

  return { ok: true, steps, receipt };
}

/**
 * An in-memory model of the R2 and database contract, for the dry run and for the tests.
 *
 * It models what the migrations promise -- attestation before any claim, one object per claim,
 * a purge receipt per object -- and nothing else. `overrides` lets a test break exactly one of
 * those promises and watch the drill refuse.
 */
export function createFixtureOps(plan, overrides = {}) {
  const bucket = new Map();
  const state = { provisioned: false, attested: false, requested: false, claimed: 0, purged: 0 };
  const clock = { at: Date.parse(plan.startedAt) };
  const fixture = {
    state,
    bucket,
    async now() {
      clock.at += 1000;
      return new Date(clock.at);
    },
    async listWorkspaceObjects(workspaceKey) {
      const prefixes = [`quarantine/${workspaceKey}/`, `immutable/${workspaceKey}/${workspaceKey}/`];
      return {
        ok: true,
        keys: [...bucket.keys()].filter((key) => prefixes.some((prefix) => key.startsWith(prefix))).sort(),
      };
    },
    async provision() {
      for (const object of plan.objects) bucket.set(object.key, object);
      state.provisioned = true;
      return { ok: true };
    },
    async graceDays() {
      return { ok: true, days: 0 };
    },
    async requestDeletion() {
      if (!state.provisioned) return { ok: false, code: "FIXTURE_NOT_PROVISIONED" };
      state.requested = true;
      return {
        ok: true,
        status: "recorded",
        deletionId: sha256(`${plan.workspaceKey}\n${plan.sourceId}`),
        eligibleAt: plan.startedAt,
      };
    },
    async attest() {
      if (!state.requested) return { ok: false, code: "FIXTURE_NOT_REQUESTED" };
      state.attested = true;
      return { ok: true, code: "ATTESTED", status: "recorded", artifactCount: plan.objects.length };
    },
    async sweepOnce() {
      // The gate, modelled: no attestation, no claim. This is the one behaviour a drill that
      // never ran must still be able to demonstrate.
      if (!state.attested) return { ok: true, receipts: [] };
      const next = plan.objects.map((object) => object.key).sort()[state.claimed];
      if (next === undefined) return { ok: true, receipts: [] };
      state.claimed += 1;
      bucket.delete(next);
      state.purged += 1;
      return { ok: true, receipts: [{ receiptId: sha256(next), status: "recorded" }] };
    },
    async sweepStatus() {
      return { ok: true, inventoryIncomplete: !state.attested };
    },
    async dbCounts() {
      return {
        ok: true,
        objects: plan.objects.length,
        purged: state.purged,
        attestations: state.attested ? 1 : 0,
        purgeReceipts: state.purged,
        tombstoneReceipts: state.requested ? 1 : 0,
      };
    },
    async backupExpiry() {
      return {
        ok: true,
        operatorId: "dry-run-operator",
        recordedAt: new Date(clock.at + 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
      };
    },
  };
  return { ...fixture, ...overrides };
}

/** Builds the real `ops` only when every variable is present. A partial environment is refused. */
export async function createLiveOps(env = process.env) {
  const missing = REQUIRED_EXECUTE_ENV.filter((name) => !(env[name] ?? "").trim());
  if (missing.length > 0) return { ok: false, code: "DRILL_ENV_INCOMPLETE", missing };
  if (env.TAVONEL_DRILL_CONFIRM.trim() !== EXECUTE_CONFIRMATION) {
    return { ok: false, code: "DRILL_CONFIRMATION_MISMATCH", missing: ["TAVONEL_DRILL_CONFIRM"] };
  }
  if (!UTC.test(env.TAVONEL_DRILL_BACKUP_EXPIRY.trim())) {
    return { ok: false, code: "DRILL_BACKUP_EXPIRY_MALFORMED", missing: ["TAVONEL_DRILL_BACKUP_EXPIRY"] };
  }
  const { createLiveDrillOps } = await import("./source-deletion-drill-live.mjs");
  return { ok: true, ops: createLiveDrillOps(env) };
}

export function receiptPath(now, drillId, directory = EVIDENCE_DIRECTORY) {
  return datedReceiptPath("SOURCE_DELETION_DRILL", now, drillId, directory);
}

async function main(argv) {
  const execute = argv.includes("--execute");
  const plan = planSourceDeletionDrill();
  let ops;
  if (execute) {
    const live = await createLiveOps();
    if (!live.ok) {
      process.stderr.write(`${live.code}: ${(live.missing ?? []).join(", ")}\n`);
      process.exitCode = 2;
      return;
    }
    ops = live.ops;
  } else {
    ops = createFixtureOps(plan);
  }

  const result = await runSourceDeletionDrill(plan, ops);
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (!execute) {
    const wouldWrite = receiptPath(new Date(), result.receipt.drillId);
    process.stdout.write(`${JSON.stringify({ dryRun: true, wouldWrite, ...result }, null, 2)}\n`);
    process.stdout.write(
      "dry run: nothing was created, deleted or written. The model is not the system.\n",
    );
    return;
  }

  const written = writeReceiptOnce(receiptPath(new Date(), result.receipt.drillId), result.receipt);
  if (!written.ok) {
    // The drill itself succeeded; refusing to publish it is still a failure, because the run
    // produced evidence that now has nowhere to go that does not destroy older evidence.
    process.stderr.write(`${written.code}: ${written.path}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${written.path}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
