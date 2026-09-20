import { createHash, timingSafeEqual } from "node:crypto";
import { ENTERPRISE_SSO_ROLES, type EnterpriseSsoRole } from "./enterprise-sso-boundary";

export type ScimCredential = {
  credentialId: string;
  tenantId: string;
  tokenSha256: string;
  expiresAt: number;
  disabled: boolean;
};

export type ScimCommand =
  | { kind: "user.upsert"; tenantId: string; requestId: string; externalId: string; userName: string; active: true; roles: EnterpriseSsoRole[] }
  | { kind: "user.deprovision"; tenantId: string; requestId: string; externalId: string; active: false }
  | { kind: "group.upsert"; tenantId: string; requestId: string; externalId: string; displayName: string; memberExternalIds: string[] };

export type ScimReceipt = { requestId: string; commandHash: string; resourceId: string; status: "applied" | "deprovisioned" };

export type ScimRequestReservation =
  | { state: "acquired"; reservationToken: string }
  | { state: "completed"; receipt: ScimReceipt }
  | { state: "conflict" }
  | { state: "pending" };

export interface ScimStore {
  reserveRequest(tenantId: string, requestId: string, commandHash: string): Promise<ScimRequestReservation | null>;
  completeRequest(tenantId: string, receipt: ScimReceipt, reservationToken: string): Promise<boolean>;
  upsertUser(command: Extract<ScimCommand, { kind: "user.upsert" }>): Promise<{ resourceId: string } | null>;
  deprovisionUser(command: Extract<ScimCommand, { kind: "user.deprovision" }>): Promise<{ resourceId: string } | null>;
  isUserDeprovisioned(tenantId: string, resourceId: string): Promise<boolean>;
  upsertGroup(command: Extract<ScimCommand, { kind: "group.upsert" }>): Promise<{ resourceId: string } | null>;
  appendAudit(event: Record<string, unknown>): Promise<boolean>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const TENANT = /^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])?$/;
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,253}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRole(value: unknown): value is EnterpriseSsoRole {
  return typeof value === "string" && ENTERPRISE_SSO_ROLES.includes(value as EnterpriseSsoRole);
}

export function authenticateScimBearer(input: {
  authorization: string | null;
  pathTenantId: string;
  credentials: readonly ScimCredential[];
  now?: number;
}) {
  const match = input.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/);
  if (!match || !TENANT.test(input.pathTenantId)) return { ok: false as const, code: "SCIM_AUTH_REQUIRED" };
  const actual = createHash("sha256").update(match[1], "utf8").digest();
  const now = input.now ?? Math.floor(Date.now() / 1000);
  for (const credential of input.credentials) {
    if (credential.tenantId !== input.pathTenantId || credential.disabled || credential.expiresAt <= now || !SHA256.test(credential.tokenSha256)) continue;
    const expected = Buffer.from(credential.tokenSha256, "hex");
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      return { ok: true as const, tenantId: credential.tenantId, credentialId: credential.credentialId };
    }
  }
  return { ok: false as const, code: "SCIM_BEARER_INVALID" };
}

export function parseScimCommand(value: unknown, pathTenantId: string): ScimCommand | null {
  if (!isRecord(value) || !TENANT.test(pathTenantId) || value.tenantId !== pathTenantId
    || typeof value.kind !== "string" || typeof value.requestId !== "string" || !ID.test(value.requestId)
    || typeof value.externalId !== "string" || !ID.test(value.externalId)) return null;
  if (value.kind === "user.deprovision") {
    return value.active === false ? { kind: value.kind, tenantId: pathTenantId, requestId: value.requestId, externalId: value.externalId, active: false } : null;
  }
  if (value.kind === "user.upsert") {
    if (value.active !== true || typeof value.userName !== "string" || !EMAIL.test(value.userName) || value.userName.length > 384
      || !Array.isArray(value.roles) || !value.roles.length || value.roles.some((role) => !isRole(role))) return null;
    return {
      kind: value.kind, tenantId: pathTenantId, requestId: value.requestId, externalId: value.externalId,
      userName: value.userName.trim().toLowerCase(), active: true,
      roles: [...new Set(value.roles as EnterpriseSsoRole[])].sort(),
    };
  }
  if (value.kind === "group.upsert") {
    if (typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 200
      || !Array.isArray(value.memberExternalIds) || value.memberExternalIds.length > 10_000
      || value.memberExternalIds.some((item) => typeof item !== "string" || !ID.test(item))) return null;
    return {
      kind: value.kind, tenantId: pathTenantId, requestId: value.requestId, externalId: value.externalId,
      displayName: value.displayName.trim(), memberExternalIds: [...new Set(value.memberExternalIds as string[])].sort(),
    };
  }
  return null;
}

function hashCommand(command: ScimCommand) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

function auditEvent(command: ScimCommand, outcome: string, resourceId?: string) {
  return {
    tenantId: command.tenantId,
    requestId: command.requestId,
    action: command.kind,
    outcome,
    resourceId,
    externalIdHash: createHash("sha256").update(command.externalId).digest("hex"),
  };
}

export async function applyScimCommand(command: ScimCommand, store: ScimStore) {
  const commandHash = hashCommand(command);
  const reservation = await store.reserveRequest(command.tenantId, command.requestId, commandHash);
  if (!reservation) return { ok: false as const, code: "SCIM_RESERVATION_UNAVAILABLE", status: 503 };
  if (reservation.state === "conflict") return { ok: false as const, code: "SCIM_REPLAY_REFUSED", status: 409 };
  if (reservation.state === "pending") return { ok: false as const, code: "SCIM_REQUEST_IN_PROGRESS", status: 409 };
  if (reservation.state === "completed") {
    if (reservation.receipt.commandHash !== commandHash || reservation.receipt.requestId !== command.requestId) {
      return { ok: false as const, code: "SCIM_REPLAY_REFUSED", status: 409 };
    }
    return { ok: true as const, replayed: true, resourceId: reservation.receipt.resourceId, status: reservation.receipt.status };
  }
  if (!reservation.reservationToken) return { ok: false as const, code: "SCIM_RESERVATION_UNAVAILABLE", status: 503 };

  let applied: { resourceId: string } | null;
  let status: ScimReceipt["status"] = "applied";
  if (command.kind === "user.upsert") applied = await store.upsertUser(command);
  else if (command.kind === "group.upsert") applied = await store.upsertGroup(command);
  else {
    applied = await store.deprovisionUser(command);
    status = "deprovisioned";
    if (applied && !await store.isUserDeprovisioned(command.tenantId, applied.resourceId)) {
      await store.appendAudit(auditEvent(command, "failed_deprovision_confirmation", applied.resourceId));
      return { ok: false as const, code: "SCIM_DEPROVISION_NOT_DURABLE", status: 503 };
    }
  }
  if (!applied) return { ok: false as const, code: "SCIM_STORE_UNAVAILABLE", status: 503 };
  if (!await store.appendAudit(auditEvent(command, status, applied.resourceId))) {
    return { ok: false as const, code: "SCIM_AUDIT_WRITE_FAILED", status: 503 };
  }
  const receipt = { requestId: command.requestId, commandHash, resourceId: applied.resourceId, status } satisfies ScimReceipt;
  if (!await store.completeRequest(command.tenantId, receipt, reservation.reservationToken)) {
    return { ok: false as const, code: "SCIM_RECEIPT_WRITE_FAILED", status: 503 };
  }
  return { ok: true as const, replayed: false, resourceId: applied.resourceId, status };
}
