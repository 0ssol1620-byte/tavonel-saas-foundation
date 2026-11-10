import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuthCallbackPage from "../app/auth/callback/page";
import { CompileJobPanel } from "../components/compile-job-panel";
import { askAbstentionCopy, askSourceCopy, EVIDENCE_EXCEEDS_ANSWER_LIMIT } from "./workspace-ask-copy";
import { blockedPanelCopy, FAILURE_COPY_CODES, originUnprovenCopy, failureSentence, isSizeLimitFailure, offersUpgrade, pageLocale, reviewReasonCopy, SIZE_LIMIT_FAILURE_CODES, sizeLimitFailureCopy } from "./workspace-failure-copy";

const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
const connections = readFileSync(new URL("../components/connections-panel.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/compile-job-panel.tsx", import.meta.url), "utf8");

describe("workspace failure copy", () => {
  it("turns a known code into a sentence and never prints the code on its own", () => {
    expect(failureSentence("AUTH_REQUIRED", 401)).toBe("Your session has expired. Sign in again.");
    expect(failureSentence("AUTH_REQUIRED", 401)).not.toContain("AUTH_REQUIRED");
    // Re-pinned 2026-11-10 (intended): GA opens processing through the terms, not an access request.
    expect(failureSentence("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403)).toContain("Accept the processing terms in your workspace");
    expect(failureSentence("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403)).not.toMatch(/request/i);
  });

  it("keeps an unmapped code reachable as a reference rather than dropping it", () => {
    const sentence = failureSentence("SOME_NEW_CODE", 500);
    expect(sentence.startsWith("Our servers could not complete this.")).toBe(true);
    expect(sentence).toContain("Reference SOME_NEW_CODE.");
  });

  it("says the daily spend stop is a safety pause for today, that queued work continues and nothing was charged, with no reset time", () => {
    for (const code of ["OCR_DAILY_SPEND_STOP", "OCR_SPEND_UNVERIFIED"]) {
      const sentence = failureSentence(code, 503);
      expect(sentence, code).toContain("paused");
      expect(sentence, code).toContain("safety limit");
      expect(sentence, code).toContain("already queued keep processing");
      expect(sentence, code).toContain("nothing was charged");
      expect(sentence, code).not.toContain(code);
      // The stop lifts at the provider's billing-day boundary, which no single clock time states truly.
      expect(sentence, code).not.toMatch(/UTC|midnight|\d{1,2}:\d{2}|minutes?|hours?/i);
    }
    expect(failureSentence("OCR_DAILY_SPEND_STOP", 503)).toContain("for today");
  });

  it("gives every plan and free-evaluation refusal its own sentence, and offers the plans for each", () => {
    const codes = ["SUBSCRIPTION_REQUIRED", "STUDIO_SUBSCRIPTION_REQUIRED", "TRIAL_FILE_LIMIT_EXCEEDED", "TRIAL_PAGE_LIMIT_EXCEEDED",
      "TRIAL_FILE_TOO_LARGE", "TRIAL_ARCHIVE_NOT_INCLUDED", "TRIAL_FEATURE_NOT_INCLUDED", "TRIAL_WORLD_LIMIT_REACHED",
      "TRIAL_LIMIT_REACHED", "TRIAL_NOT_ACTIVE"];
    const sentences = codes.map((code) => failureSentence(code, 402));
    expect(new Set(sentences).size).toBe(codes.length);
    for (const [index, sentence] of sentences.entries()) {
      expect(sentence).not.toContain("Reference");
      expect(sentence).not.toContain(codes[index]);
      expect(sentence).not.toContain(";");
      expect(offersUpgrade(`Activation failed. ${sentence} The active World is unchanged.`)).toBe(true);
    }
  });

  it("does not offer a plan for a refusal a plan cannot lift", () => {
    expect(offersUpgrade(failureSentence("TRIAL_AI_ACCESS_CHECK_FAILED", 503))).toBe(false);
    expect(offersUpgrade(failureSentence("AUTH_REQUIRED", 401))).toBe(false);
    expect(offersUpgrade(failureSentence("SOME_NEW_CODE", 402))).toBe(false);
  });

  it("says something useful when there is no code at all", () => {
    expect(failureSentence(null, 429)).toBe("Too many requests at once. Wait a minute and try again.");
    expect(failureSentence(undefined, 404)).not.toContain("Reference");
  });

  it("says a size refusal is a size limit that a retry will not change, in English and Korean, without numbers", () => {
    // REVIEW-PR192-R1 MAJOR-2: these fell through to "Our servers could not complete this", which reads as transient.
    for (const code of ["JSON_TOO_LARGE", "CORE_OUTPUT_TOO_LARGE"]) {
      expect(isSizeLimitFailure(code)).toBe(true);
      expect(failureSentence(code, 500)).not.toContain("Our servers");
      expect(failureSentence(code, 500)).toMatch(/same result/);
    }
    expect(isSizeLimitFailure("CORE_V2_TIMEOUT")).toBe(false);
    expect(isSizeLimitFailure(null)).toBe(false);
    const en = sizeLimitFailureCopy("en");
    const ko = sizeLimitFailureCopy("ko");
    expect(en.sentence).toMatch(/same result/);
    expect(en.sentence).not.toMatch(/try again|retry/i);
    expect(ko.sentence).toContain("같은 파일로 다시 실행해도 결과는 같습니다");
    for (const copy of [en, ko]) expect(copy.sentence).not.toMatch(/\d/);
    expect(sizeLimitFailureCopy()).toEqual(en);
    // The same selection is not offered again after a size refusal.
    expect(workspace).toContain("disabled={busy || !judgeCorpusSet(selectedDocumentIds.length).ok || sizeRefusedSameSet}");
    expect(workspace).toContain("isSizeLimitFailure(compileJob.errorCode)");
  });

  /*
    BQ-088 as a source fact: the workspace used to hang `(${json.code ?? response.status})` off
    fifteen otherwise readable lines. One shape, one place, so a new route cannot reintroduce
    the pattern by copying the line above it.
  */
  it("leaves no raw (code ?? status) parenthetical on a customer-facing line", () => {
    for (const [name, source] of [["workspace", workspace], ["connections", connections], ["compile job panel", panel]] as const) {
      expect(source, name).not.toContain("?? response.status})");
      expect(source, name).not.toContain("?? capability.status})");
    }
    expect(workspace).toContain('from "@/lib/workspace-failure-copy"');
  });

  /*
    Journey A1, U8 (JOURNEY-MAP-2026-10-17 D-03, D-13). Before these rows the portal's 409 read
    "Something else changed this first. Reload and look again." and a pilot refusal read "Sign in
    again." -- each a retry that never succeeds.
  */
  it("names the portal, pilot and qualification refusals instead of falling back to a status line", () => {
    for (const [code, status] of [
      ["PADDLE_CUSTOMER_NOT_FOUND", 409],
      ["PILOT_ACCESS_REQUIRED", 403],
      ["PROCESSING_QUALIFICATION_NOT_BILLABLE", 403],
    ] as const) {
      const sentence = failureSentence(code, status);
      expect(sentence, code).not.toContain(code);
      expect(sentence, code).not.toContain("Reference");
      expect(sentence, code).not.toBe(failureSentence(null, status));
    }
    expect(failureSentence("PADDLE_CUSTOMER_NOT_FOUND", 409)).not.toMatch(/reload/i);
    expect(failureSentence("PILOT_ACCESS_REQUIRED", 403)).not.toMatch(/sign in again/i);
    expect(failureSentence("PILOT_ACCESS_REQUIRED", 403)).toContain("contact page");
  });

  it("tells a refused buyer that nothing was charged", () => {
    for (const code of [
      "BILLING_LAUNCH_PENDING",
      "BILLING_NOT_CONFIGURED",
      "BILLING_OFFER_CONTACT_REQUIRED",
      "PROCESSING_QUALIFICATION_NOT_BILLABLE",
    ]) {
      expect(failureSentence(code, 503), code).toContain("nothing was charged");
    }
  });
});

/*
  The callback's access-failed card, rendered from the real component with its state preset.

  The page keeps its phase in `useState`, so a static render only ever reaches "working". As in
  `use-checkout.test.ts`, the component is called once under a dispatcher that answers its three
  `useState`s, two `useRef`s and one `useEffect`, and the element tree it returns is then rendered
  for real. Nothing is mounted, so no bootstrap request is made.
*/
function renderCallback(failureCode: string) {
  const internals = (React as unknown as Record<string, { H: unknown }>)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const states: unknown[] = ["access-failed", failureCode, false];
  let at = 0;
  const previous = internals.H;
  internals.H = {
    useState: () => [states[at++], () => undefined],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => undefined,
  };
  let tree: ReturnType<typeof AuthCallbackPage>;
  try {
    tree = AuthCallbackPage();
  } finally {
    internals.H = previous;
  }
  return renderToStaticMarkup(tree);
}

describe("sign-in callback access refusal (journey A1, D-13)", () => {
  it("sends an account the pilot does not admit to the contact page, not to a retry", () => {
    const html = renderCallback("PILOT_ACCESS_REQUIRED");

    expect(html).toContain("Workspace access needs attention.");
    expect(html).toContain(failureSentence("PILOT_ACCESS_REQUIRED", 403));
    expect(html).toContain('href="/contact"');
    expect(html).toContain(">Contact us<");
    expect(html, "a retry that can never pass is not offered").not.toContain("Try again");
  });

  it("keeps the in-place retry for every other access failure", () => {
    const html = renderCallback("ACCESS_BOOTSTRAP_UNAVAILABLE");

    expect(html).toContain("could not be completed. Please try again");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).not.toContain('href="/contact"');
  });
});

/* D0 2026-11-09 R2: the review queue printed Core's contradiction-overflow reason raw, hash and all. */
describe("review reason copy", () => {
  const group = "CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_91a27aff07c87960ea4727f31e60dc80728ec587c8cfa466fb2f5a58713f6839:claims=216:pairs=23220";
  const budget = "CONTRADICTION_PAIR_BUDGET_EXCEEDED:contradiction_group_0abc:claims=40:pairs=780";

  it("says a too-large group in English with only the counts the string carries", () => {
    const copy = reviewReasonCopy(group, "en");
    expect(copy).toEqual({
      sentence: "216 statements on one topic may conflict with each other. Comparing them takes 23,220 checks, which is more than this compile checks automatically, so a person needs to review them. Open the review to decide.",
      reference: "Reference",
    });
    expect(copy?.sentence).not.toContain("contradiction_group");
    expect(copy?.sentence).not.toContain(";");
    // R2 note 3: separate compiles are never compared with each other, so no line advises splitting the sources.
    for (const value of [group, budget]) for (const locale of ["en", "ko"] as const) expect(reviewReasonCopy(value, locale)?.sentence).not.toMatch(/split|나누/i);
  });

  it("says a spent compile budget in English", () => {
    expect(reviewReasonCopy(budget)?.sentence).toBe("40 statements on one topic may conflict with each other. This compile had already used its automatic checks on other topics, so these 780 checks were left for a person. Open the review to decide.");
  });

  it("says both codes in Korean on a Korean page", () => {
    expect(reviewReasonCopy(group, "ko")).toEqual({
      sentence: "한 주제에 서로 어긋날 수 있는 진술이 216개 있습니다. 비교에 23,220번의 확인이 필요해 이번 컴파일이 자동으로 확인하는 한도를 넘었으므로 사람이 검토해야 합니다. 검토 화면을 열어 결정하세요.",
      reference: "참조",
    });
    expect(reviewReasonCopy(budget, "ko")?.sentence).toBe("한 주제에 서로 어긋날 수 있는 진술이 40개 있습니다. 이번 컴파일은 다른 주제에서 자동 확인 한도를 이미 써서 이 780번의 확인을 사람이 검토하도록 남겼습니다. 검토 화면을 열어 결정하세요.");
  });

  it("invents no meaning for an unknown code, in either language", () => {
    expect(reviewReasonCopy("AUTHORITY_CONFLICT:doc-1:claims=3:pairs=3")).toBeNull();
    expect(reviewReasonCopy("SECURITY_STOP:doc-x", "ko")).toBeNull();
  });

  it("gives no sentence for a known code in a malformed string", () => {
    for (const malformed of [
      "CONTRADICTION_GROUP_TOO_LARGE",
      "CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_91a2:claims=216",
      "CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_91a2:claims=lots:pairs=23220",
      "CONTRADICTION_PAIR_BUDGET_EXCEEDED:contradiction_group_91a2:pairs=780:claims=40",
      `${group}:extra`,
    ]) {
      expect(reviewReasonCopy(malformed)).toBeNull();
      expect(reviewReasonCopy(malformed, "ko")).toBeNull();
    }
  });
});

/*
  Founder, 2026-11-10 (cjob-fac5555a): an English workspace printed the size refusal in Korean
  because the copy followed `navigator.languages`. The page decides; the browser does not. Every
  code this module has a sentence for is held to that, in both directions.
*/
describe("failure copy follows the page, not the browser", () => {
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  // Korean copy may name the product's own nouns and print numbers; any other Latin word is English leaking in.
  const englishWords = (text: string) => (text.match(/[A-Za-z]+/g) ?? []).filter((word) => word !== "World");
  const group = "CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_0abc:claims=3:pairs=3";
  const budget = "CONTRADICTION_PAIR_BUDGET_EXCEEDED:contradiction_group_0abc:claims=3:pairs=3";
  const englishLines = () => [
    ...FAILURE_COPY_CODES.map((code) => failureSentence(code, 500)),
    ...[400, 401, 403, 404, 409, 429, 500].map((status) => failureSentence("SOME_UNMAPPED_CODE", status)),
    ...Object.values(sizeLimitFailureCopy("en")).flatMap((value) => typeof value === "function" ? [value("1,000")]
      : typeof value === "string" ? [value] : Object.values(value)),
    ...Object.values(blockedPanelCopy("en")).map((value) => typeof value === "function" ? `${value(1)} ${value(3)}` : value),
    reviewReasonCopy(group, "en")!.sentence, reviewReasonCopy(budget, "en")!.sentence, reviewReasonCopy(group, "en")!.reference,
    ...Object.values(askAbstentionCopy(EVIDENCE_EXCEEDS_ANSWER_LIMIT, "en")).filter((value): value is string => typeof value === "string"),
    ...Object.values(askSourceCopy("en")),
  ];

  it("has no Hangul in any English line, for every failure code", () => {
    expect(FAILURE_COPY_CODES.length).toBeGreaterThan(30);
    for (const line of englishLines()) expect(line, line).not.toMatch(HANGUL);
  });

  it("has no English in any Korean line it carries", () => {
    const koreanLines = [
      ...Object.values(sizeLimitFailureCopy("ko")).flatMap((value) => typeof value === "function" ? [value("1,000")]
      : typeof value === "string" ? [value] : Object.values(value)),
      ...Object.values(blockedPanelCopy("ko")).map((value) => typeof value === "function" ? `${value(1)} ${value(3)}` : value),
      reviewReasonCopy(group, "ko")!.sentence, reviewReasonCopy(budget, "ko")!.sentence, reviewReasonCopy(group, "ko")!.reference,
      ...Object.values(askAbstentionCopy(EVIDENCE_EXCEEDS_ANSWER_LIMIT, "ko")).filter((value): value is string => typeof value === "string"),
      ...Object.values(askSourceCopy("ko")),
    ];
    for (const line of koreanLines) {
      expect(line, line).toMatch(HANGUL);
      expect(englishWords(line), line).toEqual([]);
    }
  });

  it("defaults to English and reads the page's <html lang>, never navigator.languages", () => {
    expect(pageLocale()).toBe("en"); // no document in this suite
    const sources = [workspace, panel, readFileSync(new URL("../components/review-queue.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("./workspace-ask-copy.ts", import.meta.url), "utf8")];
    for (const source of sources) expect(source).not.toMatch(/navigator\.languages/);
  });

  it("renders every size refusal in English on the English workspace, whatever the browser prefers", () => {
    const job = { jobId: "job-x", state: "failed" as const, documentsTotal: 6, documentsReady: 6, blocked: [],
      blockedResolution: null, collectionId: null,
      sizeLimit: { bytes: 38_980_103, bound: 33_554_432, largestPackageFiles: [], counts: { regions: 6_072, claims: 536 } } };
    for (const errorCode of SIZE_LIMIT_FAILURE_CODES) {
      const html = renderToStaticMarkup(React.createElement(CompileJobPanel, { job: { ...job, errorCode }, onResolve() {}, onCancel() {} }));
      expect(html).toContain("Measured size");
      expect(html).not.toMatch(HANGUL);
    }
  });
});

describe("an unproven source origin names the files and asks for a re-upload, in the page's language", () => {
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  it("lists every file it was given, says retrying will not help, and keeps each locale's script", () => {
    const names = ["pump-manual.pdf", "valve-guide.pdf"];
    const en = originUnprovenCopy(names, "en");
    const ko = originUnprovenCopy(names, "ko");
    for (const text of [en, ko]) for (const name of names) expect(text).toContain(name);
    expect(en).toMatch(/Upload them again/);
    expect(en).toMatch(/Retrying gives the same result/);
    expect(en).not.toMatch(HANGUL);
    expect(ko).toMatch(HANGUL);
    expect(ko).toContain("다시 업로드");
    expect(failureSentence("CUSTOMER_SOURCE_ORIGIN_UNPROVEN", 409)).not.toMatch(/servers could not/i);
  });
});
