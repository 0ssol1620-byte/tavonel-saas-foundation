import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleScimProvisioningRequest } from "./enterprise-identity-route-boundary";
import { applyScimCommand, authenticateScimBearer, parseScimCommand, type ScimCommand, type ScimReceipt, type ScimRequestReservation, type ScimStore } from "./enterprise-scim-boundary";

class MemoryScimStore implements ScimStore {
  reservations = new Map<string, { commandHash: string; reservationToken: string; receipt?: ScimReceipt }>();
  calls: string[] = [];
  audits: Record<string, unknown>[] = [];
  deprovisioned = new Set<string>();
  durableDeprovision = true;
  durableCompletion = true;
  userMutationBarrier?: Promise<void>;
  private userEnteredResolve!: () => void;
  userEntered = new Promise<void>((resolve) => { this.userEnteredResolve = resolve; });
  async reserveRequest(tenantId: string, requestId: string, commandHash: string): Promise<ScimRequestReservation> {
    const key = `${tenantId}:${requestId}`;
    const prior = this.reservations.get(key);
    if (prior) {
      if (prior.commandHash !== commandHash) return { state: "conflict" };
      return prior.receipt ? { state: "completed", receipt: prior.receipt } : { state: "pending" };
    }
    const reservationToken = `reservation-${this.reservations.size + 1}`;
    this.reservations.set(key, { commandHash, reservationToken });
    return { state: "acquired", reservationToken };
  }
  async completeRequest(tenantId: string, receipt: ScimReceipt, reservationToken: string) {
    if (!this.durableCompletion) return false;
    const prior = this.reservations.get(`${tenantId}:${receipt.requestId}`);
    if (!prior || prior.commandHash !== receipt.commandHash || prior.reservationToken !== reservationToken || prior.receipt) return false;
    prior.receipt = receipt;
    return true;
  }
  async upsertUser(command: Extract<ScimCommand, { kind: "user.upsert" }>) {
    this.calls.push("user");
    this.userEnteredResolve();
    if (this.userMutationBarrier) await this.userMutationBarrier;
    return { resourceId: `usr-${command.externalId}` };
  }
  async deprovisionUser(command: Extract<ScimCommand, { kind: "user.deprovision" }>) { this.calls.push("deprovision"); const id = `usr-${command.externalId}`; if (this.durableDeprovision) this.deprovisioned.add(id); return { resourceId: id }; }
  async isUserDeprovisioned(_tenantId: string, resourceId: string) { this.calls.push("confirm"); return this.deprovisioned.has(resourceId); }
  async upsertGroup(command: Extract<ScimCommand, { kind: "group.upsert" }>) { this.calls.push("group"); return { resourceId: `grp-${command.externalId}` }; }
  async appendAudit(event: Record<string, unknown>) { this.calls.push("audit"); this.audits.push(event); return true; }
}

const token = "scim-bearer-token-with-at-least-32-characters";
const credential = { credentialId: "cred-1", tenantId: "tenant-a", tokenSha256: createHash("sha256").update(token).digest("hex"), expiresAt: 2_000, disabled: false };
const user = { kind: "user.upsert", tenantId: "tenant-a", requestId: "request-1", externalId: "external-1", userName: "Person@Example.com", active: true, roles: ["member"] };

describe("B16 SCIM fail-closed boundary", () => {
  it("isolates bearer credentials to one tenant and rejects expired or malformed tokens", () => {
    expect(authenticateScimBearer({ authorization: `Bearer ${token}`, pathTenantId: "tenant-a", credentials: [credential], now: 1_000 }).ok).toBe(true);
    expect(authenticateScimBearer({ authorization: `Bearer ${token}`, pathTenantId: "tenant-b", credentials: [credential], now: 1_000 }).ok).toBe(false);
    expect(authenticateScimBearer({ authorization: `Bearer ${token}`, pathTenantId: "tenant-a", credentials: [credential], now: 2_001 }).ok).toBe(false);
  });

  it("validates tenant binding and role allowlists", () => {
    expect(parseScimCommand(user, "tenant-a")).toMatchObject({ userName: "person@example.com", roles: ["member"] });
    expect(parseScimCommand({ ...user, tenantId: "tenant-b" }, "tenant-a")).toBeNull();
    expect(parseScimCommand({ ...user, roles: ["superadmin"] }, "tenant-a")).toBeNull();
  });

  it("makes user and group provisioning idempotent and refuses changed replays", async () => {
    const store = new MemoryScimStore();
    const command = parseScimCommand(user, "tenant-a")!;
    expect(await applyScimCommand(command, store)).toMatchObject({ ok: true, replayed: false });
    expect(await applyScimCommand(command, store)).toMatchObject({ ok: true, replayed: true });
    expect(store.calls.filter((item) => item === "user")).toHaveLength(1);
    const changed = parseScimCommand({ ...user, userName: "other@example.com" }, "tenant-a")!;
    expect(await applyScimCommand(changed, store)).toMatchObject({ ok: false, code: "SCIM_REPLAY_REFUSED", status: 409 });
    expect(store.audits[0]).not.toHaveProperty("userName");
  });

  it("atomically reserves tenant, request id, and command hash before mutation", async () => {
    const store = new MemoryScimStore();
    let releaseMutation!: () => void;
    store.userMutationBarrier = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const command = parseScimCommand(user, "tenant-a")!;
    const first = applyScimCommand(command, store);
    await store.userEntered;

    expect(await applyScimCommand(command, store)).toMatchObject({ ok: false, code: "SCIM_REQUEST_IN_PROGRESS", status: 409 });
    const changed = parseScimCommand({ ...user, userName: "other@example.com" }, "tenant-a")!;
    expect(await applyScimCommand(changed, store)).toMatchObject({ ok: false, code: "SCIM_REPLAY_REFUSED", status: 409 });
    expect(store.calls.filter((item) => item === "user")).toHaveLength(1);

    releaseMutation();
    expect(await first).toMatchObject({ ok: true, replayed: false });
    expect(await applyScimCommand(command, store)).toMatchObject({ ok: true, replayed: true });
    expect(store.calls.filter((item) => item === "user")).toHaveLength(1);
  });

  it("keeps a failed completion reserved so a retry cannot repeat the mutation", async () => {
    const store = new MemoryScimStore();
    store.durableCompletion = false;
    const command = parseScimCommand(user, "tenant-a")!;
    expect(await applyScimCommand(command, store)).toMatchObject({ ok: false, code: "SCIM_RECEIPT_WRITE_FAILED", status: 503 });
    expect(await applyScimCommand(command, store)).toMatchObject({ ok: false, code: "SCIM_REQUEST_IN_PROGRESS", status: 409 });
    expect(store.calls.filter((item) => item === "user")).toHaveLength(1);
  });

  it("confirms deprovisioning before success is returned", async () => {
    const store = new MemoryScimStore();
    const command = parseScimCommand({ kind: "user.deprovision", tenantId: "tenant-a", requestId: "request-2", externalId: "external-1", active: false }, "tenant-a")!;
    expect(await applyScimCommand(command, store)).toMatchObject({ ok: true, status: "deprovisioned" });
    expect(store.calls).toEqual(["deprovision", "confirm", "audit"]);
    const failing = new MemoryScimStore();
    failing.durableDeprovision = false;
    expect(await applyScimCommand({ ...command, requestId: "request-3" }, failing)).toMatchObject({ ok: false, code: "SCIM_DEPROVISION_NOT_DURABLE" });
  });

  it("keeps the HTTP route off until activation and returns no-store responses", async () => {
    const store = new MemoryScimStore();
    const request = new Request("https://tavonel.com/api/enterprise/scim/tenant-a", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(user) });
    const disabled = await handleScimProvisioningRequest({ request, tenantId: "tenant-a", credentials: [credential], store, runtimeEnabled: false });
    expect(disabled.status).toBe(503);
    expect(disabled.headers.get("cache-control")).toBe("no-store");
  });
});
