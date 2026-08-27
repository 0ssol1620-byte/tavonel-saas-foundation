import { describe, expect, it } from "vitest";
import type { WorkspaceEntitlement, WorkspaceMembership } from "../../shared/tenantDomain";
import { issueQuarantineUploadContract } from "./r2UploadContract";

const membership: WorkspaceMembership = { workspaceId: "workspace-a", userId: "user-a", role: "member" };
const entitlement: WorkspaceEntitlement = { workspaceId: "workspace-a", status: "active", uploadBytesLimit: 10_000, uploadBytesUsed: 0, documentLimit: 2, documentCount: 0, validUntil: null };

describe("R2 quarantine upload contract", () => {
  it("cannot produce an upload URL while global customer intake is fail-closed", () => {
    const result = issueQuarantineUploadContract({ actorId: "user-a", workspaceId: "workspace-a", requestedBytes: 100, originalFilename: "synthetic.pdf", declaredMimeType: "application/pdf", membership, entitlement });
    expect(result).toEqual({ permitted: false, code: "INTAKE_DISABLED" });
  });
});
