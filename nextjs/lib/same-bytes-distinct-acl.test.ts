import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorSourceIdentity } from "./connector-source-identity";
import { detectExactDuplicatesAtIntake } from "./source-dedup";

const { viewerAccess } = vi.hoisted(() => ({ viewerAccess: vi.fn() }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccessForViewer: viewerAccess }));
vi.mock("./operations-p0", () => ({ deliverOperationsAlert: vi.fn() }));

const INPUT = {
  workspaceKey: "pilot-acme01", connectionId: "22222222-2222-4222-8222-222222222222",
  provider: "google_drive" as const, nativeId: "same-native-id", revision: "1",
};

describe("same bytes, distinct identity and ACL (M1-03)", () => {
  it("identical native id and revision under two connections or two workspaces are pairwise distinct", async () => {
    const base = await connectorSourceIdentity(INPUT);
    const otherConnection = await connectorSourceIdentity({ ...INPUT, connectionId: "33333333-3333-4333-8333-333333333333" });
    const otherWorkspace = await connectorSourceIdentity({ ...INPUT, workspaceKey: "pilot-acme02" });
    const all = [base, otherConnection, otherWorkspace];
    for (const field of ["sourceId", "sourceVersionId", "documentId"] as const) {
      expect(new Set(all.map((i) => i[field])).size).toBe(3);
    }
  });

  it("failure path: a control character in the revision is refused, never reused", async () => {
    await expect(connectorSourceIdentity({ ...INPUT, revision: "1\u001f2" })).rejects.toThrow("SOURCE_IDENTITY_INVALID");
  });

  describe("exact-digest duplicates", () => {
    const WS = "pilot-b1b1b1b1b1b14b1b";
    const NEW = "0b000000-0000-4000-8000-00000000000b";
    const OWN = "0a000000-0000-4000-8000-00000000000a";
    const HIDDEN = "0e000000-0000-4000-8000-00000000000e";
    const VIEWER = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
    const V = "a".repeat(64);
    const exact = (related: string) => ({ documentId: NEW, relatedDocumentId: related, kind: "exact_bytes", matchedOn: ["source_sha256"] });

    beforeEach(() => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      viewerAccess.mockImplementation(async (_ws: string, ids: string[]) =>
        ids.includes(HIDDEN) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true });
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); viewerAccess.mockReset(); });

    it("a copy under a connection the viewer cannot read is not named; the viewer's own copy is", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        schemaVersion: "tavonel.source_fingerprints.v1", fingerprints: 1, newRelations: 2,
        relations: [exact(HIDDEN), exact(OWN)], sourceDigestReuseCandidateDocumentIds: [], sanitizedDigestReuseDocumentIds: [],
      }), { status: 200 })));
      const notes = await detectExactDuplicatesAtIntake(
        WS, [{ documentId: NEW, versionKey: V, inputSha256: `sha256:${V}`, pageCount: 1 }],
        { NEXT_PUBLIC_SUPABASE_URL: "https://store.example", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40), TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER);
      expect(notes).toEqual([{ documentId: NEW, kind: "exact", duplicateOfDocumentIds: [OWN] }]);
      expect(JSON.stringify(notes)).not.toContain(HIDDEN);
    });
  });
});
