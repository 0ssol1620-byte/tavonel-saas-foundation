import { describe, expect, it } from "vitest";
import { decideSyntheticRunPodQualification } from "../../shared/runpodSyntheticQualification";

const permittedRequest = {
  scope: "synthetic" as const,
  immutableReleaseEvidenceVerified: true,
  capacityReadAtUtc: "2026-08-27T13:00:00.000Z",
  capacityAvailable: true,
  qualificationOnly: true,
  sshDisabled: true,
  healthPort: 8001,
  minWorkers: 0,
  persistentVolumeGiB: 0,
  containerDiskGiB: 80,
  priorCommittedUsd: 0,
  estimatedQualificationUsd: 4.5,
  mutationAttemptsForRequest: 0,
  priorWriteResult: "none" as const,
};

describe("RunPod synthetic qualification policy", () => {
  it("permits exactly one bounded synthetic qualification only after release and capacity evidence", () => {
    expect(decideSyntheticRunPodQualification(permittedRequest)).toEqual({
      allowed: true,
      code: "ONE_SHOT_QUALIFICATION_ALLOWED",
      maximumAdditionalSpendUsd: 5,
    });
  });

  it("rejects customer scope, missing capacity evidence, and missing release evidence", () => {
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, scope: "customer" }).code).toBe("SYNTHETIC_SCOPE_REQUIRED");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, capacityReadAtUtc: null }).code).toBe("CAPACITY_PREFLIGHT_REQUIRED");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, immutableReleaseEvidenceVerified: false }).code).toBe("RELEASE_EVIDENCE_REQUIRED");
  });

  it("requires a non-SSH, min-zero, no-volume health worker with enough container disk", () => {
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, sshDisabled: false }).code).toBe("SSH_PATH_FORBIDDEN");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, healthPort: 22 }).code).toBe("HEALTH_PORT_REQUIRED");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, minWorkers: 1 }).code).toBe("MIN_WORKERS_MUST_BE_ZERO");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, persistentVolumeGiB: 10 }).code).toBe("PERSISTENT_VOLUME_FORBIDDEN");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, containerDiskGiB: 79 }).code).toBe("CONTAINER_DISK_TOO_SMALL");
  });

  it("enforces the $5 ceiling and refuses replay after any prior write result", () => {
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, priorCommittedUsd: 1, estimatedQualificationUsd: 4.01 }).code).toBe("SPEND_CEILING_EXCEEDED");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, priorWriteResult: "rate_limited" }).code).toBe("AMBIGUOUS_WRITE_MUST_NOT_REPLAY");
    expect(decideSyntheticRunPodQualification({ ...permittedRequest, mutationAttemptsForRequest: 1 }).code).toBe("ONE_SHOT_WRITE_REQUIRED");
  });
});
