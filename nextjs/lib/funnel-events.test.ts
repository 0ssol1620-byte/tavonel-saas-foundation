import { describe, expect, it } from "vitest";
import { FUNNEL_DETAIL_KEYS, allowedDetail } from "./funnel-events";

/*
  The privacy sentence at the top of `funnel-events.ts`, made checkable.

  Instrumenting Explore was harmless -- a public sample world and three prepared questions. §26
  also asks for seven workspace events, and that is a signed-in, tenant-scoped surface where the
  most convenient value to attach to every one of them is a forbidden one: the collection id, the
  filename, the question the customer typed, the reason a reviewer wrote. The type stops a call
  site that compiles against this file. This stops the key list itself from drifting, and pins the
  runtime drop so a caller that reaches `trackFunnel` some other way still cannot post one.
*/
describe("funnel event property allowlist", () => {
  /*
    Named individually rather than matched by a pattern. A regex would happily admit a key called
    `sourceName`, and the point of the list is that a new key costs somebody a decision.
  */
  it("holds no key that could carry an identifier or a user string", () => {
    expect([...FUNNEL_DETAIL_KEYS]).toEqual(["act", "cta", "family", "filter", "from", "kind", "lifecycle", "mode", "offer", "plan", "plans", "scene", "sources", "status"]);
    for (const forbidden of ["id", "documentId", "collectionId", "filename", "file", "name", "path", "question", "prompt", "text", "query", "reason", "email", "user", "digest", "title"]) {
      expect(FUNNEL_DETAIL_KEYS as readonly string[], `${forbidden} is not an enumerated UI state`).not.toContain(forbidden);
    }
  });

  it("drops a property that is not on the list instead of forwarding it", () => {
    expect(allowedDetail({ kind: "Claim" })).toEqual({ kind: "Claim" });
    expect(allowedDetail({ kind: "Claim", documentId: "doc-1" } as never)).toEqual({ kind: "Claim" });
    expect(allowedDetail({ documentId: "doc-1" } as never)).toBeUndefined();
    expect(allowedDetail()).toBeUndefined();
    // A non-string is not a "count stringified by the caller"; it is a value that arrived by
    // accident, and an object serialized into an event property is how source text escapes.
    expect(allowedDetail({ scene: 3 } as never)).toBeUndefined();
  });
});
