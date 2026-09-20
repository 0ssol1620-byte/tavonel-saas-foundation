import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyExportSignature } from "./export-signing";
import {
  SIGNED_PRODUCT_DEMO_DISCLOSURE,
  SIGNED_PRODUCT_DEMO_IDS,
  signedProductDemo,
} from "./signed-product-demo";

const SHA256 = /^sha256:[a-f0-9]{64}$/;

describe("B32 signed public product demo", () => {
  it("stays explicitly synthetic and makes no customer or benchmark claim", () => {
    expect(SIGNED_PRODUCT_DEMO_DISCLOSURE).toContain("PUBLIC SAMPLE · SYNTHETIC DATA");
    expect(SIGNED_PRODUCT_DEMO_DISCLOSURE).toContain("no customer");
    expect(SIGNED_PRODUCT_DEMO_DISCLOSURE).toContain("benchmark");
    expect(SIGNED_PRODUCT_DEMO_DISCLOSURE).toContain("certification");
  });

  it("uses frozen identifiers and binds every source to exact bytes", async () => {
    expect(SIGNED_PRODUCT_DEMO_IDS).toMatchInlineSnapshot(`
      {
        "activationEventId": "activation-public-sample-fp200-r1",
        "actorUserId": "00000000-0000-4000-8000-000000000032",
        "operationId": "00000000-0000-4000-8000-000000000031",
        "reviewEventId": "review-public-sample-fp200-r1",
        "signingKeyId": "public-sample-ed25519-2026",
        "workspaceKey": "workspace-public-sample",
        "worldStateId": "world-public-sample-fp200-r1",
      }
    `);
    for (const source of signedProductDemo.fixture.sources) {
      expect(source.sha256).toMatch(SHA256);
      const bytes = readFileSync(resolve(import.meta.dirname, "../public", source.href.slice(1)));
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      expect(digest, source.href).toBe(source.sha256);
    }
  });

  it("preserves candidate, review and activation boundaries", () => {
    expect(signedProductDemo.candidate.lifecycle).toBe("candidate");
    expect(signedProductDemo.candidate.candidatePromotion).toBe(false);
    expect(signedProductDemo.candidate.validationStatus).toBe("passed");
    expect(Object.values(signedProductDemo.candidate.validationChecks)).toEqual([true, true, true, true]);
    expect(signedProductDemo.review.decision).toBe("accepted");
    expect(signedProductDemo.activation.mutationContractValid).toBe(true);
    expect(signedProductDemo.activation.manifestDigest).toBe(signedProductDemo.candidate.manifestDigest);
  });

  it("answers with an exact page region and a receipt from grounded Ask", () => {
    expect(signedProductDemo.answer.status).toBe("grounded");
    expect(signedProductDemo.answer.text).toContain("2,000 operating hours");
    expect(signedProductDemo.answer.citation.excerpt).toContain("2,000 operating hours");
    expect(signedProductDemo.answer.citation.pageNumber1).toBe(1);
    expect(signedProductDemo.answer.citation.bbox1000).toEqual([111, 131, 705, 162]);
    expect(signedProductDemo.answer.receipt.manifestDigest).toBe(signedProductDemo.candidate.manifestDigest);
    expect(signedProductDemo.answer.receipt.candidatePromotion).toBe(false);
  });

  it("produces a real Ed25519 signature while keeping signature separate from approval", () => {
    const exported = signedProductDemo.signedExport;
    expect(exported.verified).toBe(true);
    expect(exported.signature.algorithm).toBe("Ed25519");
    expect(exported.signature.schemaVersion).toBe("tavonel.export_signature.v2");
    expect(exported.signature.signedPayloadSha256).toMatch(SHA256);
    expect(exported.lifecycle).toBe("candidate");
    expect(exported.candidatePromotion).toBe(false);
    const publicKey = createPublicKey({
      key: Buffer.from(exported.signature.publicKeySpkiDerBase64, "base64"),
      format: "der",
      type: "spki",
    }).export({ format: "der", type: "spki" });
    // The module verifies the exact manifest bytes before exporting `verified=true`; this asserts
    // the verifier also rejects bytes the signed payload did not cover.
    expect(verifyExportSignature(Buffer.from("tampered\n"), exported.signature, publicKey)).toBe(false);
  });
});
