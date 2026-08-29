import { describe, expect, it } from "vitest";
import {
  collectionCandidateKey,
  groupImmutableDocuments,
  immutableWorkspacePrefix,
  isCollectionCandidateKey,
  isKeyInsideWorkspacePrefix,
  isOcrJsonKey,
} from "./immutable-keys";

const WS = "pilot-abc";
const PREFIX = `immutable/${WS}/${WS}/`;

describe("immutable workspace prefix escape", () => {
  it("accepts keys under immutable/{ws}/{ws}/", () => {
    expect(immutableWorkspacePrefix(WS)).toBe(PREFIX);
    expect(isKeyInsideWorkspacePrefix(WS, `${PREFIX}doc1/${"ab".repeat(32)}/sanitized.pdf`)).toBe(true);
    expect(isOcrJsonKey(WS, `${PREFIX}doc1/${"ab".repeat(32)}/ocr.json`)).toBe(true);
  });

  it("rejects keys that leave the owner workspace", () => {
    const rejected = [
      `immutable/other/other/doc1/${"ab".repeat(32)}/ocr.json`,
      `immutable/${WS}/other/doc1/${"ab".repeat(32)}/ocr.json`,
      `immutable/${WS}/${WS}/../other/ocr.json`,
      `immutable/${WS}/${WS}/doc1/../escape/ocr.json`,
      `${PREFIX}../../tavonel-prod/ocr.json`,
      "quarantine/pilot-abc/doc/source",
      `/immutable/${WS}/${WS}/doc/ocr.json`,
    ];
    for (const key of rejected) {
      expect(isKeyInsideWorkspacePrefix(WS, key), key).toBe(false);
      expect(isOcrJsonKey(WS, key), key).toBe(false);
    }
  });

  it("groups listing metadata without keeping foreign keys", () => {
    const digest = "ab".repeat(32);
    const items = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc1/${digest}/sanitized.pdf`, size: 12 },
      { key: `${PREFIX}doc1/${digest}/ocr.json`, size: 4 },
      { key: `${PREFIX}doc1/${digest}/cdr-receipt.json`, size: 5 },
      { key: `${PREFIX}doc1/${digest}/ocr-review.json`, size: 6 },
      { key: `immutable/evil/evil/doc1/${digest}/ocr.json`, size: 99 },
      { key: `${PREFIX}../evil/${digest}/ocr.json`, size: 99 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.documentId).toBe("doc1");
    expect(items[0]?.hasOcrJson).toBe(true);
    expect(items[0]?.sanitizedSize).toBe(12);
    expect(items[0]?.ocrJsonKey?.endsWith("/ocr.json")).toBe(true);
    expect(items[0]?.cdrReceiptKey?.endsWith("/cdr-receipt.json")).toBe(true);
    expect(items[0]?.ocrReviewKey?.endsWith("/ocr-review.json")).toBe(true);
    expect(items[0]?.processingState).toBe("ocr_ready");
  });

  it("surfaces a durable operator-review terminal state when OCR did not materialize", () => {
    const digest = "cd".repeat(32);
    const items = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc2/${digest}/sanitized.pdf`, size: 12 },
      { key: `${PREFIX}doc2/${digest}/cdr-receipt.json`, size: 5 },
      { key: `${PREFIX}doc2/${digest}/ocr-review.json`, size: 6 },
    ]);
    expect(items[0]).toEqual(expect.objectContaining({
      documentId: "doc2",
      hasOcrJson: false,
      processingState: "operator_review",
    }));
  });

  it("scopes collection candidates to one immutable workspace", () => {
    const collectionId = `collection-${"ab".repeat(16)}`;
    const key = collectionCandidateKey(WS, collectionId, "cd".repeat(32));
    expect(isCollectionCandidateKey(WS, key)).toBe(true);
    expect(isCollectionCandidateKey("pilot-other", key)).toBe(false);
    expect(collectionCandidateKey(WS, "../escape", "cd".repeat(32))).toBe("");
  });
});
