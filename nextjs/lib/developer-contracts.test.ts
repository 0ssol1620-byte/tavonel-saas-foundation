import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  parseConnectionBatchInput,
  parseConnectionInput,
  parseDeveloperScopes,
  sha256Prefixed,
} from "./developer-contracts";
import { deterministicSourceDocumentId } from "./source-intake";

describe("developer connection contracts", () => {
  it("accepts OS-mounted file servers without credential material", () => {
    expect(parseConnectionInput({
      provider: "file_server",
      mode: "local_agent",
      displayName: "Research share",
      configuration: {
        rootLabel: "patent-research",
        includeGlobs: ["**/*.pdf", "**/*.docx"],
        maxFileBytes: 50_000_000,
      },
      secretReference: null,
    })).toMatchObject({ provider: "file_server", mode: "local_agent" });
  });

  it("rejects credentials at any nesting depth", () => {
    expect(parseConnectionInput({
      provider: "s3",
      mode: "cloud_pull",
      displayName: "Unsafe bucket",
      configuration: { bucket: "research", nested: { accessKey: "do-not-store" } },
      secretReference: "vault://tavonel/research",
    })).toBeNull();
    expect(parseConnectionInput({
      provider: "file_server",
      mode: "local_agent",
      displayName: "Unsafe mount",
      configuration: {},
      secretReference: "vault://tavonel/share-password",
    })).toBeNull();
  });

  it("exposes only deployed local-agent cloud access", () => {
    expect(parseConnectionInput({
      provider: "r2",
      mode: "local_agent",
      displayName: "Evidence archive",
      configuration: { bucket: "evidence", prefix: "approved/" },
      secretReference: null,
    })).not.toBeNull();
    expect(parseConnectionInput({
      provider: "s3",
      mode: "cloud_pull",
      displayName: "Managed worker not deployed",
      configuration: { bucket: "evidence" },
      secretReference: "vault://tavonel/research-readonly",
    })).toBeNull();
  });

  it("deduplicates known scopes and rejects unknown authority", () => {
    expect(parseDeveloperScopes(["documents:read", "documents:read", "ask:read"]))
      .toEqual(["documents:read", "ask:read"]);
    expect(parseDeveloperScopes(["documents:read", "admin:all"])).toBeNull();
  });
});

describe("connection sync batch", () => {
  it("accepts only the canonical manifest digest", async () => {
    const events = [{
      kind: "added",
      nativeId: "folder/report.pdf",
      revision: "etag-1",
      contentSha256: "a".repeat(64),
      sizeBytes: 1_024,
      mimeType: "application/pdf",
      documentId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      sourceIdempotencyKey: "d".repeat(64),
    }];
    const manifestSha256 = await sha256Prefixed(canonicalJson(events));
    await expect(parseConnectionBatchInput({
      batchId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      previousCursorSha256: null,
      nextCursorSha256: `sha256:${"b".repeat(64)}`,
      manifestSha256,
      events,
    })).resolves.toMatchObject({ manifestSha256, events });
    await expect(parseConnectionBatchInput({
      batchId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      previousCursorSha256: null,
      nextCursorSha256: `sha256:${"b".repeat(64)}`,
      manifestSha256: `sha256:${"c".repeat(64)}`,
      events,
    })).resolves.toBeNull();
  });

  it("requires deletion tombstones to carry no stale content metadata", async () => {
    const events = [{
      kind: "deleted",
      nativeId: "folder/removed.pdf",
      revision: "deleted:etag-1",
      contentSha256: "a".repeat(64),
      sizeBytes: null,
      mimeType: null,
      documentId: null,
      sourceIdempotencyKey: null,
    }];
    await expect(parseConnectionBatchInput({
      batchId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      previousCursorSha256: null,
      nextCursorSha256: `sha256:${"b".repeat(64)}`,
      manifestSha256: await sha256Prefixed(canonicalJson(events)),
      events,
    })).resolves.toBeNull();
  });

  it("rebinds uploaded document IDs to the tenant and source-event key", async () => {
    const workspaceKey = "pilot-1234567890abcdef";
    const sourceIdempotencyKey = "e".repeat(64);
    const documentId = await deterministicSourceDocumentId(workspaceKey, sourceIdempotencyKey);
    const events = [{
      kind: "added",
      nativeId: "folder/report.pdf",
      revision: "sha256:source",
      contentSha256: "a".repeat(64),
      sizeBytes: 128,
      mimeType: "application/pdf",
      documentId,
      sourceIdempotencyKey,
    }];
    const input = {
      batchId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      previousCursorSha256: null,
      nextCursorSha256: `sha256:${"b".repeat(64)}`,
      manifestSha256: await sha256Prefixed(canonicalJson(events)),
      events,
    };
    await expect(parseConnectionBatchInput(input, workspaceKey)).resolves.not.toBeNull();
    const forgedEvents = [{ ...events[0], documentId: "59d42924-a3cc-4a09-b92d-9c86b58901a1" }];
    await expect(parseConnectionBatchInput({
      ...input,
      manifestSha256: await sha256Prefixed(canonicalJson(forgedEvents)),
      events: forgedEvents,
    }, workspaceKey)).resolves.toBeNull();
  });
});
