import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET } from "../app/api/v1/capabilities/route";
import {
  CAPABILITY_MANIFEST,
  capabilityTokenLabel,
  isAcceptedAtUpload,
  publicCapabilityRows,
  sharedAcceptedLimitationLabels,
} from "../../shared/capabilityManifest";
import { capabilityStatuses } from "../../shared/uskcEnums";

/*
  The website API of blueprint §10.

  What is worth asserting here is not that a route returns JSON. It is that the payload is the
  manifest and nothing else: the moment this handler starts composing its own view of what the
  product supports, there are six lists again instead of one, and the drift the manifest exists
  to prevent has moved inside the thing preventing it.
*/
type Payload = typeof CAPABILITY_MANIFEST & { contentSha256: string };

async function payload(): Promise<Payload> {
  return (await GET().json()) as Payload;
}

describe("GET /api/v1/capabilities", () => {
  it("serves the manifest unmodified", async () => {
    const { contentSha256: _digest, ...body } = await payload();
    expect(body).toEqual(JSON.parse(JSON.stringify(CAPABILITY_MANIFEST)));
  });

  it("binds the payload to a digest a caller can pin", async () => {
    const body = await payload();
    const expected = createHash("sha256").update(JSON.stringify(CAPABILITY_MANIFEST), "utf8").digest("hex");
    expect(body.contentSha256).toBe(`sha256:${expected}`);
    expect(GET().headers.get("ETag")).toBe(`"sha256:${expected}"`);
  });

  /*
    The digest a caller can actually reproduce, run the way the route's comment says to run it.

    A reviewer measured sha256 of the served body, found it was not `contentSha256`, and was
    right to: the field cannot be inside the document it measures. The recompute is "drop the
    last key, re-serialize", and this test performs it on the response bytes rather than on the
    manifest object, so the documented procedure is the thing under test.
  */
  it("recomputes from the served bytes by dropping contentSha256 and re-serializing", async () => {
    const served = await GET().text();
    const { contentSha256, ...manifest } = JSON.parse(served) as Payload;
    const recomputed = createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex");
    expect(contentSha256).toBe(`sha256:${recomputed}`);
    // And it is not the digest of the body it rides in -- saying so would be the false claim.
    const ofTheWholeBody = createHash("sha256").update(served, "utf8").digest("hex");
    expect(contentSha256).not.toBe(`sha256:${ofTheWholeBody}`);
  });

  it("is cacheable and public, because it carries no tenant", async () => {
    const cacheControl = GET().headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).not.toContain("no-store");
    const serialized = JSON.stringify(await payload());
    for (const secret of ["workspaceId", "tenantId", "documentId", "Authorization"]) {
      expect(serialized, `the manifest must not carry ${secret}`).not.toContain(secret);
    }
  });

  /*
    The fail-closed half. A consumer generating an upload picker from this response must not be
    able to find a format that the server would refuse, and must not be told anything is
    qualified while no qualification run has happened.
  */
  it("advertises no capability the deployment cannot support", async () => {
    const body = await payload();
    expect(body.defaultStatus).toBe("UNSUPPORTED");
    for (const entry of body.entries) {
      expect(["VERIFIED_NATIVE", "VERIFIED_HYBRID"], `${entry.mime} is advertised as verified`)
        .not.toContain(entry.status);
      expect(entry.qualificationReceipt).toBeNull();
      if (entry.status === "UNSUPPORTED") expect(entry.readerPlan).toEqual([]);
    }
  });
});

/*
  BA-060. The public projection, checked as a boundary rather than as a shape.

  `/sources` renders a client component, so whatever the page hands it is serialized into the
  payload every visitor downloads. It was handed `CAPABILITY_MANIFEST`, which carries the reader
  plan's internal component ids with their revisions, a per-format qualification receipt state,
  the date it was qualified and the default status -- none of it rendered, all of it shipped.
  This repository already separates a public DTO from an internal one for route features; the
  manifest was the surface that had not.

  Two things are asserted, and the second is the one that rots without a test. First, that none
  of the four internal fields is reachable through the projection. Second, that no manifest
  *identifier* is either: the projection resolves every label on the server, so a payload holds
  "Best effort" and "Up to 5 MB per source", never `BEST_EFFORT` or `at_most_5_mib_per_source`.
  The obvious regression is someone adding a field to the row type and passing the key through,
  which reads as harmless and puts the vocabulary back on the wire.
*/
describe("the public projection of the manifest", () => {
  const rows = publicCapabilityRows();

  it("projects every row the manifest carries", () => {
    expect(rows).toHaveLength(CAPABILITY_MANIFEST.entries.length);
    expect(rows.map((row) => row.mime).sort())
      .toEqual(CAPABILITY_MANIFEST.entries.map((entry) => entry.mime).sort());
  });

  it("carries none of the internal fields", () => {
    const wire = JSON.stringify(rows);
    for (const field of ["readerPlan", "qualificationReceipt", "qualifiedAt", "defaultStatus"]) {
      expect(wire, `${field} reaches the client`).not.toContain(field);
    }
    // And the reader plan's values, not only its key: the ids are the disclosure that matters.
    for (const provider of ["cdr_sanitizer_v1", "foundation_ocr_gpu_v1"]) {
      expect(wire, `${provider} is an internal component id`).not.toContain(provider);
    }
  });

  it("carries written labels and no manifest identifier", () => {
    const wire = JSON.stringify(rows);
    for (const status of capabilityStatuses) {
      expect(wire, `${status} is an enum, not a label`).not.toContain(status);
    }
    /*
      Every key the manifest uses for a preserved value or a limitation, in any row.

      Checked as its quoted JSON form rather than as a bare substring: `page` is a key and also
      three letters inside "Up to 80 pages per source", so a substring check would fail on a
      correct label. An array element that *is* the key serializes as `"page"`, and a written
      label never does.
    */
    const keys = new Set(CAPABILITY_MANIFEST.entries.flatMap((entry) => [
      ...entry.preserved, ...entry.knownLimitations,
    ]));
    expect(keys.size).toBeGreaterThan(5);
    for (const key of keys) {
      expect(wire, `${key} is a manifest key, not a label`).not.toContain(`"${key}"`);
    }
    // The projection is not empty of content, which is what would make the above vacuous.
    expect(rows.every((row) => row.tier.length > 0 && row.preserved.length + row.specific.length >= 0)).toBe(true);
    expect(rows.some((row) => row.preserved.includes("Exact region"))).toBe(true);
    expect(rows.some((row) => row.tier === "Best effort")).toBe(true);
  });

  /*
    The hoisted sentence and the rows have to partition the limitations between them, or a
    limitation is either stated twice or lost. The archive row shares none of the accepted set,
    which is why the shared set is measured over accepted rows only.
  */
  it("states each limitation either once in the row or once in the shared sentence", () => {
    const shared = sharedAcceptedLimitationLabels();
    expect(shared.length).toBeGreaterThan(0);
    for (const [index, entry] of CAPABILITY_MANIFEST.entries.entries()) {
      const row = rows[index]!;
      const all = entry.knownLimitations.map(capabilityTokenLabel);
      const stated = isAcceptedAtUpload(entry.status)
        ? [...row.specific, ...shared.filter((label) => all.includes(label))]
        : row.specific;
      expect([...stated].sort(), `${entry.mime} loses or repeats a limitation`).toEqual([...all].sort());
      for (const label of row.specific) {
        expect(shared, `${entry.mime} repeats a shared limitation in its row`).not.toContain(label);
      }
    }
  });
});
