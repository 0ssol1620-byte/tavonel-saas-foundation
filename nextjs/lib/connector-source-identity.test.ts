import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { connectorSourceIdentity } from "./connector-source-identity";
import { deterministicSourceDocumentId } from "./source-intake";

const INPUT = { workspaceKey: "pilot-acme01", connectionId: "22222222-2222-4222-8222-222222222222",
  provider: "google_drive" as const, nativeId: "native-file", revision: "1" };
describe("connector source identity", () => {
  it("keeps one source across revisions with distinct immutable versions", async () => {
    const first = await connectorSourceIdentity(INPUT);
    const next = await connectorSourceIdentity({ ...INPUT, revision: "2" });
    expect(first.sourceId).toBe(next.sourceId);
    expect(first.sourceVersionId).not.toBe(next.sourceVersionId);
    expect(first.documentId).not.toBe(next.documentId);
    expect(await connectorSourceIdentity(INPUT)).toEqual(first);
  });
  it("preserves the existing admitted document id", async () => {
    const oldKey = createHash("sha256").update(`${INPUT.connectionId}\u001f${INPUT.nativeId}\u001f${INPUT.revision}`).digest("hex");
    expect((await connectorSourceIdentity(INPUT)).documentId).toBe(await deterministicSourceDocumentId(INPUT.workspaceKey, oldKey));
  });
  it.each([
    { workspaceKey: "pilot-other01" }, { connectionId: "33333333-3333-4333-8333-333333333333" },
    { provider: "dropbox" as const }, { nativeId: "another-file" },
  ])("separates logical sources by scope %j", async changes => {
    expect((await connectorSourceIdentity({ ...INPUT, ...changes })).sourceId).not.toBe((await connectorSourceIdentity(INPUT)).sourceId);
  });
  it.each(["", " ", "x\u001fy", "x\u0000y", "x".repeat(513)])("refuses missing or ambiguous native identity %j", async nativeId => {
    await expect(connectorSourceIdentity({ ...INPUT, nativeId })).rejects.toThrow("SOURCE_IDENTITY_INVALID");
    await expect(connectorSourceIdentity({ ...INPUT, revision: nativeId })).rejects.toThrow("SOURCE_IDENTITY_INVALID");
  });
});
