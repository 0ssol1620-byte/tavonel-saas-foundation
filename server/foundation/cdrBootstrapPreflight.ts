export const cdrBootstrapPreflight = {
  repository: "0ssol1620-byte/tavonel-compiled-world-activation",
  region: "asia-northeast3",
  connection: "tavonel-cdr-github-seoul",
  commit: "e017cb65b8dd0a666740aa53a671a4ae10171dda",
  configPath: "quarantine-sidecar/cdr-cloudrun/cloudbuild.bootstrap-cdr-secret.yaml",
  configSha256: "d7819a196466dc0c19b2fef404705296d5c3e469f245590f04643c1192305163",
  executionServiceAccount: "tavonel-cdr-secret-bootstrap@tavonel-knowledge-compiler.iam.gserviceaccount.com",
  automaticTriggerAllowed: false,
  secretPayloadHandling: "generated-in-build-only" as const,
} as const;

export function isExactBootstrapPreflight(input: {
  commit: string;
  configSha256: string;
  region: string;
  automaticTriggerAllowed: boolean;
}) {
  return (
    input.commit === cdrBootstrapPreflight.commit &&
    input.configSha256 === cdrBootstrapPreflight.configSha256 &&
    input.region === cdrBootstrapPreflight.region &&
    input.automaticTriggerAllowed === false
  );
}
