import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALIDATION_CHECK_REVIEW_REASON } from "../../shared/compiledWorldValidation";
import { EXTRACTION_BUDGET_REACHED } from "./collection-compiler";
import { DEVELOPER_SCOPES } from "./developer-contracts";
import { displayName, documentReference } from "./document-names";
import { formatDay, formatTimestamp } from "./format";
import {
  describeReviewReason, isOpaqueId, isReasonCode, labelForReference, NEUTRAL_BY_POLICY, NEUTRAL_HEADLINE, NEUTRAL_MEANING,
  PLAIN_REASON_CODES, plainEvent, plainScope, SENTENCE_SOURCES, shortReference, workspaceDocumentTitle,
} from "./plain-language";

/*
  UI-D. The plain-language layer: every code the review screen can print has a sentence, an id is never a
  label, and a raw code is never a headline.
*/

const validatorSource = readFileSync(new URL("../scripts/compiled-world/validate.mjs", import.meta.url), "utf8");
/* SIGNATURE_PRESENT is pushed to `notices`, never to `errors`: it can never be a review reason, so it has no row. */
const validatorCodes = [...validatorSource.matchAll(/code: "([A-Z_]+)"/g)].map((match) => match[1]!).filter((code) => code !== "SIGNATURE_PRESENT");

/** Every code a review reason can start with, from the sources that write them. */
const knownReasonCodes = [
  EXTRACTION_BUDGET_REACHED,
  ...Object.values(VALIDATION_CHECK_REVIEW_REASON),
  ...validatorCodes,
  "READING_NEEDS_OPERATOR_REVIEW", "READING_DID_NOT_FINISH", "READING_LISTING_DISAGREEMENT", "SOURCE_VERSION_AMBIGUOUS",
  "OCR_SOURCE_EMPTY", "OCR_PAGES_INCOMPLETE", "OCR_TIMEOUT_OR_NETWORK", "OCR_RECOGNITION_CONFLICT:page-1",
  "CONTRADICTION_CANDIDATE:claim-a:claim-b",
  "CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_91a2:claims=216:pairs=23220",
  "CONTRADICTION_PAIR_BUDGET_EXCEEDED:contradiction_group_91a2:claims=40:pairs=780",
];

describe("review reasons in plain English (D-02)", () => {
  it("gives a code no repo source states only the neutral sentence, with the exact code kept as the technical reference", () => {
    for (const code of [...NEUTRAL_BY_POLICY, "SOMETHING_NEW_AND_UNMAPPED", "SECURITY_STOP:doc-x", "OCR_LOW_TEXT_YIELD doc-y"]) {
      const reason = describeReviewReason(code);
      expect(reason.known, code).toBe(false);
      expect(reason.headline, code).toBe(NEUTRAL_HEADLINE);
      expect(reason.meaning, code).toBe(NEUTRAL_MEANING);
      expect(reason.didWhat).toContain("held this result back");
      expect(reason.technical).toBe(code);
    }
    expect(NEUTRAL_HEADLINE).toBe("One of the checks on this result did not pass.");
    expect(NEUTRAL_MEANING).toBe("The exact check is shown under Technical details.");
  });

  it("has no row, and so says nothing about a cause, for a code only the Python core or a list of names carries", () => {
    for (const code of NEUTRAL_BY_POLICY) {
      expect(PLAIN_REASON_CODES, code).not.toContain(code);
      expect(SENTENCE_SOURCES[code], code).toBeUndefined();
    }
  });

  /*
    The structural rule. Every sentence other than the neutral one is listed with the file:line that states it,
    and the cited file must contain the cited code. A new sentence without a citation, or a citation that
    stopped being true, fails here instead of reaching a customer.
  */
  it("cites, for every non-neutral sentence, a file in this repo that contains the code", () => {
    const root = new URL("../../", import.meta.url);
    expect(Object.keys(SENTENCE_SOURCES).sort()).toEqual([...PLAIN_REASON_CODES].sort());
    for (const code of PLAIN_REASON_CODES) {
      const citations = SENTENCE_SOURCES[code]!;
      expect(citations.length, code).toBeGreaterThan(0);
      const found = citations.some((citation) => {
        const [file, line] = citation.split(/:(?=\d+$)/) as [string, string];
        const lines = readFileSync(new URL(file, root), "utf8").split(/\r?\n/);
        const at = Number(line);
        expect(at, citation).toBeGreaterThan(0);
        expect(at, citation).toBeLessThanOrEqual(lines.length);
        return lines.slice(Math.max(0, at - 6), at + 5).some((text) => text.includes(code));
      });
      expect(found, `${code}: no cited file:line contains the code`).toBe(true);
    }
  });

  it("says nothing of a mechanism or cause in the sentences that have no source", () => {
    const mechanism = /because|scan|faint|blurr|image|too (large|small)|could not read|tie back|second|twice|repeat|stable|between runs/i;
    for (const code of [...NEUTRAL_BY_POLICY, "SOMETHING_NEW_AND_UNMAPPED", "SECURITY_STOP:doc-x"]) {
      const reason = describeReviewReason(code);
      expect(`${reason.headline} ${reason.meaning}`, code).not.toMatch(mechanism);
    }
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
    expect(reason.meaning).toBe(NEUTRAL_MEANING);
    expect(describeReviewReason("SECURITY_STOP:doc-x").headline).toBe(NEUTRAL_HEADLINE);
  });

  it("reads a code followed by a document id, as the queue records some of them", () => {
    expect(describeReviewReason("OCR_SOURCE_EMPTY doc-y").known).toBe(true);
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

/*
  B1 (independent review). Each sentence says only what the code establishes in the source that raises it.
  These fail on the first wording, which described a "second check" that does not exist, said the compile
  "stopped before it looked at everything" when it looked at everything and kept part, told the customer to
  wait for uploads to finish for an error no customer action changes, and called a normal notice a problem.
*/
describe("sentences match what the code means (B1)", () => {
  const text = (code: string) => { const r = describeReviewReason(code); return `${r.headline} ${r.meaning} ${r.next}`; };

  it("EXTRACTION_BUDGET_REACHED: the compile looked at everything and kept part of it", () => {
    const reason = describeReviewReason("EXTRACTION_BUDGET_REACHED");
    expect(reason.headline).toBe("This compile kept only part of what it found.");
    expect(text("EXTRACTION_BUDGET_REACHED")).not.toMatch(/stopped|before it looked|did not look/i);
    expect(readFileSync(new URL("./collection-compiler.ts", import.meta.url), "utf8")).toContain("counts every distinct object the extractors derived");
  });

  it("DETERMINISTIC_MATERIALIZATION_UNPROVEN: the files disagree with their own record, no second check", () => {
    expect(describeReviewReason("DETERMINISTIC_MATERIALIZATION_UNPROVEN").headline).toBe("The files in this version failed the package's own file checks.");
    expect(text("DETERMINISTIC_MATERIALIZATION_UNPROVEN")).not.toMatch(/second time|checked again|repeatable|disagree with their own record/i);
  });

  it("READING_LISTING_DISAGREEMENT: says what the worker says (no document to drop), no invented advice about uploads", () => {
    const reason = describeReviewReason("READING_LISTING_DISAGREEMENT");
    expect(reason.next).toBe("This is not caused by one document you can drop. Send us the reference.");
    expect(`${reason.meaning} ${reason.next}`).not.toMatch(/our side|nothing you change|fixes this/i);
    expect(text("READING_LISTING_DISAGREEMENT")).not.toMatch(/uploads have finished|compile again/i);
    expect(readFileSync(new URL("./compile-job-worker.ts", import.meta.url), "utf8")).toContain("no answer the customer gives changes it");
  });

  it("SIGNATURE_PRESENT is a notice, not a problem, so it has no problem sentence", () => {
    expect(validatorSource).toContain('notices.push({ code: "SIGNATURE_PRESENT"');
    expect(validatorSource).not.toMatch(/errors\.push\(\{ code: "SIGNATURE_PRESENT"/);
    expect(PLAIN_REASON_CODES).not.toContain("SIGNATURE_PRESENT");
    expect(text("SIGNATURE_PRESENT")).not.toMatch(/should not have/i);
  });

  it("PAGE_OUT_OF_RANGE says only what the validator tests: a page number that is not valid", () => {
    expect(validatorSource).toContain("(pages are 1-based)");
    expect(validatorSource).not.toMatch(/pageNumber1\s*>\s*\w*(count|total|last)/i);
    const text = describeReviewReason("PAGE_OUT_OF_RANGE").meaning;
    expect(text).toBe("A page region has a page number that is not valid.");
    expect(text).not.toMatch(/last page|past|beyond|document's/i);
  });

  it("OCR_PAGES_INCOMPLETE says nothing was assembled, never that part of the document is in the result", () => {
    expect(readFileSync(new URL("../../quarantine-sidecar/foundation-cdr-worker/src/ocr.ts", import.meta.url), "utf8")).toContain("nothing was assembled");
    const reason = describeReviewReason("OCR_PAGES_INCOMPLETE");
    expect(reason.meaning).toContain("nothing was assembled");
    expect(`${reason.headline} ${reason.meaning} ${reason.next}`).not.toMatch(/only part|part of the document|upload it again|clearer/i);
  });

  it("states no cause, advice or mechanism that no source in this repo gives (review round 3)", () => {
    const meaning = (code: string) => describeReviewReason(code).meaning;
    expect(meaning("ID_NOT_STABLE")).not.toMatch(/change between runs|would change/i);
    expect(meaning("COLLECTION_ID_NOT_STABLE")).not.toMatch(/change between runs|would change/i);
    expect(meaning("IMMUTABLE_INPUTS_ONLY_UNPROVEN")).not.toMatch(/stored copy|fingerprint did not match/i);
    expect(meaning("COUNTS_DISAGREE")).not.toMatch(/add up/i);
    expect(meaning("OCR_RECOGNITION_CONFLICT")).not.toMatch(/read the same page twice/i);
    expect(describeReviewReason("OCR_TIMEOUT_OR_NETWORK").next).not.toMatch(/upload it again/i);
    expect(describeReviewReason("SOURCE_VERSION_AMBIGUOUS").next).not.toMatch(/remove the extra copies/i);
    expect(describeReviewReason("PAGE_OUT_OF_RANGE").next).not.toMatch(/compile again/i);
  });
});

describe("the review filter names a reason in plain words (B3)", () => {
  it("labels a code-shaped reason by its headline and keeps a written sentence as it was", async () => {
    const { reasonOptionLabel, reasonOptionLabels } = await import("../components/review-queue");
    expect(reasonOptionLabel("SEMANTIC_CLAIMS_EMPTY")).toBe(NEUTRAL_HEADLINE);
    // Labels that would read the same are numbered, so the options stay distinguishable without printing a code.
    expect(reasonOptionLabels(["SEMANTIC_CLAIMS_EMPTY", "OCR_LOW_TEXT_YIELD doc-y", "OCR_SOURCE_EMPTY"]))
      .toEqual([`${NEUTRAL_HEADLINE} (1)`, `${NEUTRAL_HEADLINE} (2)`, "This document is empty."]);
    expect(reasonOptionLabel("CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_91a2:claims=216:pairs=23220")).toBe("Many statements on one topic may conflict.");
    expect(reasonOptionLabel("SEMANTIC_CLAIMS_EMPTY")).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    expect(reasonOptionLabel("A short sentence someone wrote.")).toBe("A short sentence someone wrote.");
  });
});

describe("the workspace says nothing that promises an activation path for a held version (B2, B3)", () => {
  const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
  it("the review-required notice carries the same sentence as the Review screen", () => {
    expect(page).not.toContain("Resolve its blockers before activation");
    expect(page).toContain("Review-required package loaded. ${verifiedPackage} ${REVIEW_REQUIRED_ACTIVATION_NOTE}");
  });
  it("no notice prints a collection id", () => {
    expect(page).not.toContain("review-required package for ${json.collectionId}");
    expect(page).not.toContain("Compiled World ${json.collectionId}");
    expect(page).not.toContain("OCR JSON verified for ${target.documentId}");
  });
});

describe("a long recorded code cannot widen the page (B5)", () => {
  const css = readFileSync(new URL("../app/workspace-no1.css", import.meta.url), "utf8");
  it("wraps code inside Technical details and lets the details item shrink", () => {
    expect(css).toMatch(/\.workspace-review-reason details code \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.workspace-review-reason > details \{[^}]*min-width: 0/);
  });
});

/*
  Review round 4 (rD3 notes). Sentences that claimed trust, evidence or readiness the state does not guarantee.
*/
describe("no sentence promises evidence, trust or a fix the state does not guarantee (rD3)", () => {
  it("N4: a reason with no page evidence of its own does not point at the evidence list", () => {
    for (const code of ["OCR_SOURCE_EMPTY", "READING_DID_NOT_FINISH", "OCR_TIMEOUT_OR_NETWORK", "SOURCE_VERSION_AMBIGUOUS", "SOURCE_COVERAGE_INCOMPLETE", "EVIDENCE_COVERAGE_INCOMPLETE", "IMMUTABLE_INPUTS_ONLY_UNPROVEN", "DETERMINISTIC_MATERIALIZATION_UNPROVEN", "MODEL_EMPTY", "PAGE_OUT_OF_RANGE"]) {
      expect(describeReviewReason(code).next, code).not.toMatch(/pages and evidence|see what was read/i);
    }
    // The neutral sentence points nowhere either: it may stand for a result with no evidence at all.
    expect(describeReviewReason("SOMETHING_NEW_AND_UNMAPPED").next).toBe("Send us the reference if you want us to look at it.");
    // A reason that is about page evidence still says where to look.
    expect(describeReviewReason("CONTRADICTION_CANDIDATE:a:b").next).toMatch(/pages and evidence/);
  });

  it("OCR_PAGES_INCOMPLETE does not say whether the document is in the result (ocr.ts says only that nothing was assembled)", () => {
    expect(describeReviewReason("OCR_PAGES_INCOMPLETE").meaning).not.toMatch(/in the result/);
  });

  it("states entities, evidence and JSON as the validator names them", () => {
    expect(describeReviewReason("EVIDENCE_DANGLING").meaning).toBe("An item points at evidence that is not in the result.");
    expect(describeReviewReason("ENTITY_DANGLING").meaning).toBe("An item refers to an entity that is not in the result.");
    expect(describeReviewReason("DETERMINISTIC_MATERIALIZATION_UNPROVEN").meaning).toContain("not valid JSON");
    expect(describeReviewReason("DETERMINISTIC_MATERIALIZATION_UNPROVEN").meaning).not.toContain("read back");
  });

  const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
  const grounded = readFileSync(new URL("./grounded-ask.ts", import.meta.url), "utf8");

  it("N1: the setup checklist does not say every statement is tied to a page", async () => {
    const { deriveOnboardingSteps } = await import("./workspace-onboarding");
    const onboarding = readFileSync(new URL("./workspace-onboarding.ts", import.meta.url), "utf8");
    expect(onboarding).not.toContain("Every statement in it is tied to the page it came from");
    expect(onboarding).toContain("Checks run on the result before it can be activated.");
    expect(typeof deriveOnboardingSteps).toBe("function");
  });

  it("N2: the held-version panel offers files and a new compile without implying that clears the hold", () => {
    expect(page).not.toContain("Or add or replace files and compile again.");
    expect(page).toContain("You can also add or replace files and compile again. The reasons for the hold are listed in Review.");
  });

  it("N4/N6: Ask says only what it does, matching on pages, and abstains when no region matches", () => {
    expect(page).not.toContain("supports an answer");
    expect(page).not.toContain("supports an answer, TAVONEL says so instead of guessing");
    expect(page).toContain("If no page in it matches your question, TAVONEL says so.");
    expect(grounded).toContain('"NO_REGION_BOUND_EVIDENCE_MATCH"');
  });

  it("N7: the compile notice does not say nothing is active (an earlier version may be)", () => {
    expect(page).not.toContain("and nothing is active yet.");
    expect(page).toContain("The signed download is available and nothing was activated.");
  });
});
