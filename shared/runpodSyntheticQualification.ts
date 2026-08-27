export const SYNTHETIC_GPU_SPEND_CEILING_USD = 5;
export const SYNTHETIC_CONTAINER_DISK_FLOOR_GIB = 80;

export type SyntheticRunPodQualificationRequest = {
  scope: "synthetic" | "customer";
  immutableReleaseEvidenceVerified: boolean;
  capacityReadAtUtc?: string | null;
  capacityAvailable: boolean;
  qualificationOnly: boolean;
  sshDisabled: boolean;
  healthPort: number;
  minWorkers: number;
  persistentVolumeGiB: number;
  containerDiskGiB: number;
  priorCommittedUsd: number;
  estimatedQualificationUsd: number;
  mutationAttemptsForRequest: number;
  priorWriteResult?: "none" | "success" | "unauthorized" | "forbidden" | "rate_limited" | "ambiguous" | null;
};

export type SyntheticRunPodQualificationDecision =
  | { allowed: false; code: "SYNTHETIC_SCOPE_REQUIRED" | "RELEASE_EVIDENCE_REQUIRED" | "CAPACITY_PREFLIGHT_REQUIRED" | "CAPACITY_UNAVAILABLE" | "QUALIFICATION_MODE_REQUIRED" | "SSH_PATH_FORBIDDEN" | "HEALTH_PORT_REQUIRED" | "MIN_WORKERS_MUST_BE_ZERO" | "PERSISTENT_VOLUME_FORBIDDEN" | "CONTAINER_DISK_TOO_SMALL" | "INVALID_COST" | "SPEND_CEILING_EXCEEDED" | "ONE_SHOT_WRITE_REQUIRED" | "AMBIGUOUS_WRITE_MUST_NOT_REPLAY" }
  | { allowed: true; code: "ONE_SHOT_QUALIFICATION_ALLOWED"; maximumAdditionalSpendUsd: number };

function validNonNegativeAmount(value: number) {
  return Number.isFinite(value) && value >= 0;
}

/**
 * This policy is intentionally provider-independent: it validates the only
 * state in which a caller may issue a future paid RunPod create/write request.
 * It does not make a network request or select an endpoint/image credential.
 */
export function decideSyntheticRunPodQualification(
  request: SyntheticRunPodQualificationRequest,
): SyntheticRunPodQualificationDecision {
  if (request.scope !== "synthetic") return { allowed: false, code: "SYNTHETIC_SCOPE_REQUIRED" };
  if (!request.immutableReleaseEvidenceVerified) return { allowed: false, code: "RELEASE_EVIDENCE_REQUIRED" };
  if (!request.capacityReadAtUtc) return { allowed: false, code: "CAPACITY_PREFLIGHT_REQUIRED" };
  if (!request.capacityAvailable) return { allowed: false, code: "CAPACITY_UNAVAILABLE" };
  if (!request.qualificationOnly) return { allowed: false, code: "QUALIFICATION_MODE_REQUIRED" };
  if (!request.sshDisabled) return { allowed: false, code: "SSH_PATH_FORBIDDEN" };
  if (request.healthPort !== 8001) return { allowed: false, code: "HEALTH_PORT_REQUIRED" };
  if (request.minWorkers !== 0) return { allowed: false, code: "MIN_WORKERS_MUST_BE_ZERO" };
  if (request.persistentVolumeGiB !== 0) return { allowed: false, code: "PERSISTENT_VOLUME_FORBIDDEN" };
  if (request.containerDiskGiB < SYNTHETIC_CONTAINER_DISK_FLOOR_GIB) return { allowed: false, code: "CONTAINER_DISK_TOO_SMALL" };
  if (!validNonNegativeAmount(request.priorCommittedUsd) || !validNonNegativeAmount(request.estimatedQualificationUsd)) {
    return { allowed: false, code: "INVALID_COST" };
  }
  if (request.priorCommittedUsd + request.estimatedQualificationUsd > SYNTHETIC_GPU_SPEND_CEILING_USD) {
    return { allowed: false, code: "SPEND_CEILING_EXCEEDED" };
  }
  if (request.priorWriteResult && request.priorWriteResult !== "none") {
    return { allowed: false, code: "AMBIGUOUS_WRITE_MUST_NOT_REPLAY" };
  }
  if (request.mutationAttemptsForRequest !== 0) return { allowed: false, code: "ONE_SHOT_WRITE_REQUIRED" };
  return {
    allowed: true,
    code: "ONE_SHOT_QUALIFICATION_ALLOWED",
    maximumAdditionalSpendUsd: SYNTHETIC_GPU_SPEND_CEILING_USD - request.priorCommittedUsd,
  };
}
