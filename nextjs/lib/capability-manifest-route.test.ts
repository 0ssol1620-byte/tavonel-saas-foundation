import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET } from "../app/api/v1/capabilities/route";
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";

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
