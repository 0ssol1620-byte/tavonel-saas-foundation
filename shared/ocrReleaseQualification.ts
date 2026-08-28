import {
  decideSyntheticRunPodQualification,
  type SyntheticRunPodQualificationDecision,
  type SyntheticRunPodQualificationRequest,
} from "./runpodSyntheticQualification";

export type OcrReleaseEvidence = {
  scope?: string;
  imageName?: string | null;
  imageDigest?: string | null;
  immutableReleaseEvidenceVerified?: boolean;
  capacityReadAtUtc?: string | null;
  capacityAvailable?: boolean;
  qualificationOnly?: boolean;
  sshDisabled?: boolean;
  healthPort?: number;
  minWorkers?: number;
  persistentVolumeGiB?: number;
  containerDiskGiB?: number;
  priorCommittedUsd?: number;
  estimatedQualificationUsd?: number;
  mutationAttemptsForRequest?: number;
  priorWriteResult?: SyntheticRunPodQualificationRequest["priorWriteResult"];
};

const DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;

export function ocrImageDigestPresent(digest: string | null | undefined): boolean {
  return typeof digest === "string" && DIGEST_PATTERN.test(digest.trim());
}

/**
 * Map an evidence file (docs/evidence/ocr/release.json) into the synthetic
 * RunPod qualification request. A real digest is what flips release evidence;
 * this helper never calls RunPod.
 */
export function qualificationRequestFromOcrRelease(
  evidence: OcrReleaseEvidence,
): SyntheticRunPodQualificationRequest {
  const digestPresent = ocrImageDigestPresent(evidence.imageDigest);
  return {
    scope: evidence.scope === "customer" ? "customer" : "synthetic",
    immutableReleaseEvidenceVerified: Boolean(evidence.immutableReleaseEvidenceVerified) || digestPresent,
    capacityReadAtUtc: evidence.capacityReadAtUtc ?? null,
    capacityAvailable: Boolean(evidence.capacityAvailable),
    qualificationOnly: evidence.qualificationOnly !== false,
    sshDisabled: evidence.sshDisabled !== false,
    healthPort: typeof evidence.healthPort === "number" ? evidence.healthPort : 0,
    minWorkers: typeof evidence.minWorkers === "number" ? evidence.minWorkers : 1,
    persistentVolumeGiB: typeof evidence.persistentVolumeGiB === "number" ? evidence.persistentVolumeGiB : 1,
    containerDiskGiB: typeof evidence.containerDiskGiB === "number" ? evidence.containerDiskGiB : 0,
    priorCommittedUsd: typeof evidence.priorCommittedUsd === "number" ? evidence.priorCommittedUsd : 0,
    estimatedQualificationUsd:
      typeof evidence.estimatedQualificationUsd === "number" ? evidence.estimatedQualificationUsd : 0,
    mutationAttemptsForRequest:
      typeof evidence.mutationAttemptsForRequest === "number" ? evidence.mutationAttemptsForRequest : 0,
    priorWriteResult: evidence.priorWriteResult ?? "none",
  };
}

export function decideOcrReleaseQualification(
  evidence: OcrReleaseEvidence,
): SyntheticRunPodQualificationDecision {
  return decideSyntheticRunPodQualification(qualificationRequestFromOcrRelease(evidence));
}
