import { describe, expect, it } from "vitest";
import { planSourceDeletionDrill } from "../scripts/db/source-deletion-drill.mjs";
import { connectorSourceIdentity } from "./connector-source-identity";

// The guarded binding writer refuses identities that do not derive from their fields, so the live
// deletion drill must derive them exactly as the application does.
describe("deletion drill binding identities", () => {
  it("derive exactly like connectorSourceIdentity and stay stable for one nonce", async () => {
    const plan = planSourceDeletionDrill({ now: new Date("2026-10-01T00:00:00Z"), nonce: "0d5f1e2a-3b4c-4d5e-8f60-718293a4b5c6" });
    expect(plan.bindings).toHaveLength(2);
    for (const binding of plan.bindings) {
      const identity = await connectorSourceIdentity({ workspaceKey: plan.workspaceKey, connectionId: plan.oauthConnectionId,
        provider: plan.provider as "google_drive", nativeId: binding.nativeId, revision: binding.revision });
      expect({ sourceId: plan.sourceId, sourceVersionId: binding.sourceVersionId, documentId: binding.documentId }).toEqual(identity);
    }
    expect(plan.documentIds).toEqual(plan.bindings.map(binding => binding.documentId));
    expect(new Set(plan.documentIds).size).toBe(2);
    const again = planSourceDeletionDrill({ now: new Date("2026-10-02T00:00:00Z"), nonce: "0d5f1e2a-3b4c-4d5e-8f60-718293a4b5c6" });
    expect([again.oauthConnectionId, again.documentIds]).toEqual([plan.oauthConnectionId, plan.documentIds]);
    expect(planSourceDeletionDrill({ nonce: "1e6a2f3b-4c5d-4e6f-9071-8293a4b5c6d7" }).oauthConnectionId).not.toBe(plan.oauthConnectionId);
  });
});
