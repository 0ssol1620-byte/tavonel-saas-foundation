/**
 * What a signed progress URL is allowed to reach.
 *
 * This URL is a capability: whoever holds it can read the object it names, with no further check.
 * The value of the guard is therefore entirely in what it refuses. Every test below is a way
 * someone could try to widen it -- a different tenant's prefix, a traversal, the immutable
 * `ocr.json` next to it, the original PDF -- and the guard has to say no to all of them.
 */

import { describe, expect, it } from "vitest";
import { assertWorkspaceProgressKey, presignWorkspaceProgressGet } from "./r2-presign";
import { FOUNDATION_R2_BUCKET } from "./r2-synthetic-canary";
import { immutableWorkspacePrefix } from "./immutable-keys";

const WORKSPACE = "ws_pilot";
const PREFIX = immutableWorkspacePrefix(WORKSPACE);
const PROGRESS = `${PREFIX}doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/ocr-progress.json`;

const signer = {
  bucket: FOUNDATION_R2_BUCKET,
  accountId: "acct",
  accessKeyId: "AKIAFIXTURE",
  secretAccessKey: "fixture-secret",
};

describe("progress read capability", () => {
  it("admits a progress object inside the caller's own workspace", () => {
    expect(assertWorkspaceProgressKey(FOUNDATION_R2_BUCKET, WORKSPACE, PROGRESS)).toBeNull();
  });

  it("refuses every neighbouring object, including the immutable record", () => {
    const base = `${PREFIX}doc_1/abcdabcdabcdabcdabcdabcdabcdabcd`;
    for (const key of [`${base}/ocr.json`, `${base}/sanitized.pdf`, `${base}/cdr-receipt.json`, `${base}/ocr-review.json`]) {
      expect(assertWorkspaceProgressKey(FOUNDATION_R2_BUCKET, WORKSPACE, key)).toBe("KEY_NOT_PROGRESS");
    }
  });

  it("refuses another tenant's progress object", () => {
    const other = `${immutableWorkspacePrefix("ws_other")}doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/ocr-progress.json`;
    expect(assertWorkspaceProgressKey(FOUNDATION_R2_BUCKET, WORKSPACE, other)).toBe("KEY_OUTSIDE_WORKSPACE");
  });

  it("refuses traversal and doubled separators", () => {
    expect(assertWorkspaceProgressKey(FOUNDATION_R2_BUCKET, WORKSPACE, `${PREFIX}../ws_other/ocr-progress.json`)).toBe("KEY_NOT_QUALIFIED");
    expect(assertWorkspaceProgressKey(FOUNDATION_R2_BUCKET, WORKSPACE, `${PREFIX}doc_1//ocr-progress.json`)).toBe("KEY_NOT_QUALIFIED");
  });

  it("refuses a bucket that is not the Foundation quarantine", () => {
    expect(assertWorkspaceProgressKey("tavonel-prod", WORKSPACE, PROGRESS)).toBe("BUCKET_NOT_FOUNDATION");
  });

  it("refuses a filename that merely contains the suffix", () => {
    // The check is on `/ocr-progress.json`, so the whole final path segment must be that name.
    // A file called `evil-ocr-progress.json` is a different object and is refused.
    for (const name of ["evil-ocr-progress.json", "ocr-progress.jsonx", "ocr-progress.json.bak", "OCR-PROGRESS.JSON"]) {
      expect(assertWorkspaceProgressKey(FOUNDATION_R2_BUCKET, WORKSPACE, `${PREFIX}doc_1/${name}`)).toBe("KEY_NOT_PROGRESS");
    }
  });

  it("signs a GET that names the object and expires", () => {
    const signed = presignWorkspaceProgressGet(signer, { workspaceId: WORKSPACE, key: PROGRESS, expiresInSeconds: 120, now: new Date("2026-08-30T00:00:00.000Z") });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const url = new URL(signed.readUrl);
    expect(url.pathname).toContain("ocr-progress.json");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    // A read capability must not carry a content type it could be replayed as a write with.
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(signed.readUrl).not.toContain("secret");
  });

  it("refuses to sign anything the guard rejected", () => {
    const other = `${immutableWorkspacePrefix("ws_other")}doc_1/abcdabcdabcdabcdabcdabcdabcdabcd/ocr-progress.json`;
    const signed = presignWorkspaceProgressGet(signer, { workspaceId: WORKSPACE, key: other, expiresInSeconds: 120 });
    expect(signed.ok).toBe(false);
  });

  it("produces a different signature for a different key", () => {
    const now = new Date("2026-08-30T00:00:00.000Z");
    const a = presignWorkspaceProgressGet(signer, { workspaceId: WORKSPACE, key: PROGRESS, expiresInSeconds: 120, now });
    const b = presignWorkspaceProgressGet(signer, { workspaceId: WORKSPACE, key: `${PREFIX}doc_2/abcdabcdabcdabcdabcdabcdabcdabcd/ocr-progress.json`, expiresInSeconds: 120, now });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(new URL(a.readUrl).searchParams.get("X-Amz-Signature")).not.toBe(new URL(b.readUrl).searchParams.get("X-Amz-Signature"));
  });
});
