import { describe, expect, it } from "vitest";
import { buildReleaseManifest, verifyReleaseManifestChecksum, type ReleaseManifestInput } from "./release-manifest";

const digest = (byte: string) => `sha256:${byte.repeat(64)}`;
const complete: ReleaseManifestInput = {
  generatedAt: "2026-09-20T00:00:00.000Z",
  site: { commit: "a".repeat(40), sourceDigest: digest("1"), dirty: false },
  productCore: { digest: digest("2"), source: "deployment:TAVONEL_PRODUCT_CORE_IMAGE_DIGEST" },
  images: {
    ocr: { digest: digest("3"), source: "docs/evidence/ocr/release.json" },
    cdr: { digest: digest("4"), source: "deployment:TAVONEL_CDR_IMAGE_DIGEST" },
  },
  databaseSchema: { digest: digest("5"), source: "supabase/migrations+shared schemas" },
  policyBundle: { digest: digest("6"), source: "docs/policy+runtime policy" },
};

describe("release manifest", () => {
  it("marks bindings complete only with every binding and a clean site tree", () => {
    const manifest = buildReleaseManifest(complete);
    expect(manifest.status).toBe("bindings_complete");
    expect(manifest.missing).toEqual([]);
    expect(manifest.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verifyReleaseManifestChecksum(manifest)).toBe(true);
  });

  it("names every absent or mutable release binding", () => {
    const manifest = buildReleaseManifest({
      ...complete,
      site: { ...complete.site, dirty: true },
      productCore: { ...complete.productCore, digest: null },
      images: { ...complete.images, cdr: { ...complete.images.cdr, digest: "latest" } },
    });
    expect(manifest.status).toBe("incomplete");
    expect(manifest.missing).toEqual(["images.cdr.digest", "productCore.digest", "site.cleanTree"]);
  });

  it("detects a manifest whose bound data was changed after hashing", () => {
    const manifest = buildReleaseManifest(complete);
    const tampered = { ...manifest, productCore: { ...manifest.productCore, digest: digest("9") } };
    expect(verifyReleaseManifestChecksum(tampered)).toBe(false);
  });

  it("rejects invalid timestamps and empty provenance sources", () => {
    const manifest = buildReleaseManifest({
      ...complete,
      generatedAt: "not-a-date",
      productCore: { ...complete.productCore, source: "" },
    });
    expect(manifest.status).toBe("incomplete");
    expect(manifest.missing).toEqual(["generatedAt", "productCore.source"]);
  });
});
