import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALIDATION_CHECK_REVIEW_REASON } from "../../shared/compiledWorldValidation";
import { EXTRACTION_BUDGET_REACHED } from "./collection-compiler";
import { DEVELOPER_SCOPES } from "./developer-contracts";
import { displayName, documentReference } from "./document-names";
import { formatDay, formatTimestamp } from "./format";
import {
  describeReviewReason, isOpaqueId, isReasonCode, labelForReference, PLAIN_REASON_CODES, plainEvent, plainScope,
  shortReference, workspaceDocumentTitle,
} from "./plain-language";

/*
  UI-D. The plain-language layer: every code the review screen can print has a sentence, an id is never a
  label, and a raw code is never a headline.
*/

const validatorCodes = [...readFileSync(new URL("../scripts/compiled-world/validate.mjs", import.meta.url), "utf8")
  .matchAll(/code: "([A-Z_]+)"/g)].map((match) => match[1]!);

/** Every code a review reason can start with, from the sources that write them. */
const knownReasonCodes = [
  "SEMANTIC_CLAIMS_EMPTY",
  EXTRACTION_BUDGET_REACHED,
  ...Object.values(VALIDATION_CHECK_REVIEW_REASON),
  ...validatorCodes,
  "READING_NEEDS_OPERATOR_REVIEW", "READING_DID_NOT_FINISH", "READING_LISTING_DISAGREEMENT", "SOURCE_VERSION_AMBIGUOUS",
  "OCR_LOW_TEXT_YIELD", "OCR_SOURCE_EMPTY", "OCR_PAGES_INCOMPLETE", "OCR_TIMEOUT_OR_NETWORK", "OCR_RECOGNITION_CONFLICT:page-1",
  "CONTRADICTION_CANDIDATE:claim-a:claim-b",
  "CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_91a2:claims=216:pairs=23220",
  "CONTRADICTION_PAIR_BUDGET_EXCEEDED:contradiction_group_91a2:claims=40:pairs=780",
];

describe("review reasons in plain English (D-02)", () => {
  it("explains SEMANTIC_CLAIMS_EMPTY as what it means, what TAVONEL did and what to do next", () => {
    const reason = describeReviewReason("SEMANTIC_CLAIMS_EMPTY");
    expect(reason.known).toBe(true);
    expect(reason.headline).toBe("No statements could be taken from these documents.");
    expect(reason.meaning.length).toBeGreaterThan(20);
    expect(reason.didWhat).toContain("held this result back");
    expect(reason.next.length).toBeGreaterThan(20);
    expect(reason.technical).toBe("SEMANTIC_CLAIMS_EMPTY");
  });

  it("has a sentence for every code the review screen can show", () => {
    expect(validatorCodes.length).toBeGreaterThan(20);
    for (const code of knownReasonCodes) {
      expect(describeReviewReason(code).known, code).toBe(true);
    }
    // The table is not wider than what it was built from: every row still resolves.
    for (const code of PLAIN_REASON_CODES) expect(describeReviewReason(code).known, code).toBe(true);
  });

  it("never prints a raw code in the headline, meaning or next step", () => {
    for (const code of [...knownReasonCodes, "SOMETHING_NEW_AND_UNMAPPED", "SECURITY_STOP:doc-x"]) {
      const reason = describeReviewReason(code);
      const body = `${reason.headline} ${reason.meaning} ${reason.didWhat} ${reason.next}`;
      expect(body, code).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
      expect(reason.technical).toBe(code);
    }
  });

  it("invents no meaning for a code it has no row for", () => {
    const reason = describeReviewReason("SOMETHING_NEW_AND_UNMAPPED");
    expect(reason.known).toBe(false);
    expect(reason.meaning).toContain("does not guess");
    expect(describeReviewReason("SECURITY_STOP:doc-x").headline).toBe("A safety check stopped this document.");
  });

  it("reads a code followed by a document id, as the queue records some of them", () => {
    expect(describeReviewReason("OCR_LOW_TEXT_YIELD doc-y").known).toBe(true);
    expect(isReasonCode("OCR_LOW_TEXT_YIELD doc-y")).toBe(true);
    expect(isReasonCode("The document was refused by an earlier check.")).toBe(false);
  });
});

describe("ids are never labels (D-03)", () => {
  const uuid = "10fc3cfd-2cef-49f6-8ff5-7a2bb6ed360d";
  const hex64 = "7f6b9f06".repeat(8);

  it("uses 'Untitled document' with the short reference as a tooltip when the real name is unknown", () => {
    expect(displayName(uuid, {})).toBe("Untitled document");
    expect(displayName(uuid, {})).not.toMatch(/10FC3C|10fc3c|Source/);
    expect(documentReference(uuid, {})).toBe("Reference 10FC3C");
    expect(displayName(uuid, { [uuid]: "Services Agreement.pdf" })).toBe("Services Agreement.pdf");
  });

  it("never returns an opaque id as a label", () => {
    for (const id of [uuid, `ev_${hex64}`, `collection-${"22071765".repeat(4)}`, `ws_${hex64.slice(0, 40)}`, hex64]) {
      expect(isOpaqueId(id), id).toBe(true);
      const { label, title } = labelForReference(id);
      expect(label, id).not.toBe(id);
      expect(label).not.toMatch(/[0-9a-f]{8}/i);
      expect(title).toMatch(/^Reference [0-9A-Z]{1,8}$/);
    }
    expect(labelForReference(`ev_${hex64}`).label).toBe("Evidence record");
    expect(labelForReference(`collection-${"22071765".repeat(4)}`).label).toBe("Compiled result");
    expect(labelForReference("Services Agreement.pdf")).toEqual({ label: "Services Agreement.pdf", title: undefined });
    expect(shortReference(hex64)).toHaveLength(8);
  });
});

describe("scopes and events in plain words (D-05)", () => {
  it("describes every developer scope and none by its token", () => {
    for (const scope of DEVELOPER_SCOPES) {
      expect(plainScope(scope), scope).not.toContain(":");
      expect(plainScope(scope)).not.toMatch(/has no description for/);
    }
  });

  it("names audit events without the snake_case", () => {
    expect(plainEvent("oauth_connection_synced")).toBe("Connection synced");
    expect(plainEvent("api_key_revoked")).toBe("API key revoked");
    expect(plainEvent("some_future_event")).toBe("Some future event");
  });
});

describe("dates are the same on every machine (D-18)", () => {
  it("pins UTC and the locale, so a Korean or US browser prints the same text", () => {
    const stamp = formatTimestamp("2026-11-26T09:44:00Z");
    expect(stamp).toBe("26 Nov 2026, 09:44 UTC");
    expect(stamp).not.toMatch(/AM|PM|오전|오후/);
    expect(formatDay("2026-12-05T23:30:00Z")).toBe("05 Dec 2026 UTC");
    expect(formatDay("not a date")).toBeNull();
  });

  it("no workspace surface formats a date with the browser's own locale", () => {
    for (const file of [
      "../app/workspace/page.tsx", "../components/developer-panel.tsx", "../components/operations-ultimate.tsx",
      "../components/workspace/agent-access-panel.tsx",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/Intl\.DateTimeFormat\(\)|Intl\.DateTimeFormat\(undefined|toLocaleString\(\)|toLocaleDateString\(\)/);
    }
  });
});

describe("a tab title names the surface (D-09)", () => {
  it("leads with the page and counts documents only on Home", () => {
    expect(workspaceDocumentTitle("Home", 141)).toBe("Home · 141 documents — TAVONEL");
    expect(workspaceDocumentTitle("Home", 1)).toBe("Home · 1 document — TAVONEL");
    expect(workspaceDocumentTitle("Review", 141)).toBe("Review — TAVONEL");
    expect(workspaceDocumentTitle("Review", 141)).not.toMatch(/141/);
    expect(workspaceDocumentTitle("Activity", 3)).not.toBe(workspaceDocumentTitle("Review", 3));
  });
});
