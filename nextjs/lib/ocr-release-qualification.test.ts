import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decideOcrReleaseQualification,
  qualificationRequestFromOcrRelease,
  type OcrReleaseEvidence,
} from "../../shared/ocrReleaseQualification";

const templatePath = join(dirname(fileURLToPath(import.meta.url)), "../../docs/evidence/ocr/release.json");
const template = JSON.parse(readFileSync(templatePath, "utf8")) as OcrReleaseEvidence;

describe("OCR release qualification helper", () => {
  it("keeps the committed template RELEASE_EVIDENCE_REQUIRED", () => {
    expect(template.immutableReleaseEvidenceVerified).toBe(false);
    expect(template.imageDigest).toBe("");
    expect(decideOcrReleaseQualification(template)).toEqual({
      allowed: false,
      code: "RELEASE_EVIDENCE_REQUIRED",
    });
  });

  it("allows the $5 no-ssh 8001 minWorkers-0 volume-0 request when a digest is present", () => {
    const withDigest = {
      ...template,
      imageDigest: `sha256:${"ab".repeat(32)}`,
    };
    const request = qualificationRequestFromOcrRelease(withDigest);
    expect(request.immutableReleaseEvidenceVerified).toBe(true);
    expect(request.sshDisabled).toBe(true);
    expect(request.healthPort).toBe(8001);
    expect(request.minWorkers).toBe(0);
    expect(request.persistentVolumeGiB).toBe(0);
    expect(request.estimatedQualificationUsd).toBeLessThanOrEqual(5);
    expect(decideOcrReleaseQualification(withDigest)).toEqual({
      allowed: true,
      code: "ONE_SHOT_QUALIFICATION_ALLOWED",
      maximumAdditionalSpendUsd: 5,
    });
  });
});
