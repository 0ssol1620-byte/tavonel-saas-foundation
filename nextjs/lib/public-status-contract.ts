export const PUBLIC_STATUS_SCHEMA = "tavonel.public_status.v2" as const;

export type PublicStatusAction = {
  enabled: boolean;
  href: string;
  reason: string;
};

export type PublicStatusV2 = {
  schemaVersion: typeof PUBLIC_STATUS_SCHEMA;
  service: {
    name: "TAVONEL";
    state: "not_assessed";
    commercialMode: "pilot" | "live";
  };
  availableActions: {
    readPublicWorld: PublicStatusAction;
    requestPilot: PublicStatusAction;
    signIn: PublicStatusAction;
    createAccount: PublicStatusAction;
    purchasePlan: PublicStatusAction;
    compileCustomerDocuments: PublicStatusAction;
  };
  checkedAt: string;
  evidenceFreshness: {
    basis: "configuration_snapshot";
    operationalProbe: "not_included";
  };
};

const ACTION_NAMES = [
  "readPublicWorld",
  "requestPilot",
  "signIn",
  "createAccount",
  "purchasePlan",
  "compileCustomerDocuments",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is PublicStatusAction {
  return isRecord(value)
    && typeof value.enabled === "boolean"
    && typeof value.href === "string"
    && value.href.startsWith("/")
    && typeof value.reason === "string"
    && value.reason.length > 0;
}

/**
 * Parse the public status boundary before a browser consumer acts on it.
 *
 * Unknown, legacy, partial, or malformed payloads return null so signup and checkout remain
 * closed. This deliberately does not translate the legacy DTO: migration failures must stay
 * visible while `/api/status` remains available to external N-1 consumers.
 */
export function parsePublicStatusV2(value: unknown): PublicStatusV2 | null {
  if (!isRecord(value) || value.schemaVersion !== PUBLIC_STATUS_SCHEMA) return null;
  if (!isRecord(value.service)
    || value.service.name !== "TAVONEL"
    || value.service.state !== "not_assessed"
    || (value.service.commercialMode !== "pilot" && value.service.commercialMode !== "live")) return null;
  const actions = value.availableActions;
  if (!isRecord(actions) || ACTION_NAMES.some((name) => !isAction(actions[name]))) return null;
  if (typeof value.checkedAt !== "string" || Number.isNaN(Date.parse(value.checkedAt))) return null;
  if (!isRecord(value.evidenceFreshness)
    || value.evidenceFreshness.basis !== "configuration_snapshot"
    || value.evidenceFreshness.operationalProbe !== "not_included") return null;
  return value as PublicStatusV2;
}
