import { activationPolicy } from "./activation-policy";
import { readCommercialState, type CommercialState } from "./commercial-state";
import { readAccessMode, type AccessMode } from "./foundation-pilot";
import { PUBLIC_STATUS_SCHEMA, type PublicStatusV2 } from "./public-status-contract";

export { PUBLIC_STATUS_SCHEMA } from "./public-status-contract";

type PublicCapabilityPolicy = Readonly<Record<
  "customerIntake" | "cdr" | "ocrGpu" | "customerData",
  { enabled: boolean; reason: string }
>>;

type PublicStatusInputs = {
  now: Date;
  commercial: CommercialState;
  accessMode: AccessMode;
  authReady: boolean;
  policy: PublicCapabilityPolicy;
};

const CLOSED_REASON = "This action is not open in this deployment. Request a scoped pilot to continue.";

/**
 * The public projection of deployment state.
 *
 * It reports only decisions a customer can act on. Provider names, environment-variable presence,
 * bucket/signer state, internal service topology and individual readiness checks belong to an
 * authenticated operator view. `operationalProbe` is explicit because a configuration snapshot
 * must not be mistaken for a request that exercised the document path.
 */
export function buildPublicStatusV2(inputs: PublicStatusInputs): PublicStatusV2 {
  const customerPathReady = inputs.policy.customerIntake.enabled
    && inputs.policy.cdr.enabled
    && inputs.policy.ocrGpu.enabled
    && inputs.policy.customerData.enabled;
  const selfServiceReady = inputs.authReady && inputs.accessMode === "self_service" && customerPathReady;
  const purchaseReady = inputs.commercial.liveChargesEnabled && selfServiceReady;

  return {
    schemaVersion: PUBLIC_STATUS_SCHEMA,
    service: { name: "TAVONEL", state: "not_assessed", commercialMode: inputs.commercial.mode },
    availableActions: {
      readPublicWorld: {
        enabled: true,
        href: "/explore",
        reason: "A completed public Compiled World is open to inspect.",
      },
      requestPilot: {
        enabled: true,
        href: "/contact",
        reason: "Customer document processing is arranged as a scoped pilot.",
      },
      signIn: {
        enabled: inputs.authReady,
        href: inputs.authReady ? "/login" : "/contact",
        reason: inputs.authReady
          ? "Sign-in is available."
          : "Sign-in is not available in this deployment.",
      },
      createAccount: {
        enabled: selfServiceReady,
        href: selfServiceReady ? "/login" : "/contact",
        reason: selfServiceReady ? "Self-service account creation is open." : CLOSED_REASON,
      },
      purchasePlan: {
        enabled: purchaseReady,
        href: purchaseReady ? "/pricing" : "/contact",
        reason: purchaseReady
          ? "A plan can be purchased for an available customer workflow."
          : "Purchasing does not enable customer document processing in this deployment.",
      },
      compileCustomerDocuments: {
        enabled: customerPathReady,
        href: customerPathReady ? "/workspace" : "/contact",
        reason: customerPathReady ? "Customer document compilation is open." : inputs.policy.customerData.reason,
      },
    },
    checkedAt: inputs.now.toISOString(),
    evidenceFreshness: {
      basis: "configuration_snapshot",
      operationalProbe: "not_included",
    },
  };
}

export function readPublicStatusV2(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): PublicStatusV2 {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  return buildPublicStatusV2({
    now,
    commercial: readCommercialState(env),
    accessMode: readAccessMode(env),
    authReady: supabaseUrl.startsWith("https://") && Boolean(supabaseAnon),
    policy: activationPolicy,
  });
}
