import { applyScimCommand, authenticateScimBearer, parseScimCommand, type ScimCredential, type ScimStore } from "./enterprise-scim-boundary";
import { validateSsoAssertion, verifyAndConsumeSsoState, type ReplayStore, type SsoTenantConfig, type VerifiedSsoAssertion } from "./enterprise-sso-boundary";

export const IDENTITY_NO_STORE = { "Cache-Control": "no-store" };

export async function handleScimProvisioningRequest(input: {
  request: Request;
  tenantId: string;
  credentials: readonly ScimCredential[];
  store: ScimStore;
  runtimeEnabled: boolean;
}) {
  if (!input.runtimeEnabled) return Response.json({ code: "SCIM_PROVIDER_NOT_ACTIVATED" }, { status: 503, headers: IDENTITY_NO_STORE });
  const auth = authenticateScimBearer({ authorization: input.request.headers.get("authorization"), pathTenantId: input.tenantId, credentials: input.credentials });
  if (!auth.ok) return Response.json({ code: auth.code }, { status: 401, headers: IDENTITY_NO_STORE });
  const declared = Number(input.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 1_048_576) return Response.json({ code: "SCIM_REQUEST_TOO_LARGE" }, { status: 413, headers: IDENTITY_NO_STORE });
  const text = await input.request.text();
  if (Buffer.byteLength(text, "utf8") > 1_048_576) return Response.json({ code: "SCIM_REQUEST_TOO_LARGE" }, { status: 413, headers: IDENTITY_NO_STORE });
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return Response.json({ code: "SCIM_JSON_INVALID" }, { status: 400, headers: IDENTITY_NO_STORE }); }
  const command = parseScimCommand(value, auth.tenantId);
  if (!command) return Response.json({ code: "SCIM_COMMAND_INVALID" }, { status: 400, headers: IDENTITY_NO_STORE });
  const result = await applyScimCommand(command, input.store);
  if (!result.ok) return Response.json({ code: result.code }, { status: result.status, headers: IDENTITY_NO_STORE });
  return Response.json({ code: result.replayed ? "SCIM_REPLAY_ACCEPTED" : "SCIM_APPLIED", resourceId: result.resourceId, status: result.status }, { status: result.replayed ? 200 : 201, headers: IDENTITY_NO_STORE });
}

export async function handleSsoCallbackBoundary(input: {
  tenantId: string;
  state: string;
  stateSecrets: Readonly<Record<string, string | undefined>>;
  replayStore: ReplayStore;
  config: SsoTenantConfig;
  assertion: VerifiedSsoAssertion;
  existingUser: boolean;
  runtimeEnabled: boolean;
  now?: number;
}) {
  if (!input.runtimeEnabled) return { ok: false as const, code: "SSO_PROVIDER_NOT_ACTIVATED", status: 503 };
  const state = await verifyAndConsumeSsoState({ state: input.state, expectedTenantId: input.tenantId, secrets: input.stateSecrets, replayStore: input.replayStore, now: input.now });
  if (!state.ok) return { ok: false as const, code: state.code, status: 401 };
  const assertion = await validateSsoAssertion({ assertion: input.assertion, config: input.config, existingUser: input.existingUser, replayStore: input.replayStore, now: input.now });
  if (!assertion.ok) return { ok: false as const, code: assertion.code, status: 403 };
  return { ok: true as const, identity: assertion.identity, returnPath: state.claims.returnPath };
}
