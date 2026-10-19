import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EvaluationPage from "@/components/evaluation-page";
import { activationPolicy } from "@/lib/activation-policy";

// Only the public site chrome is replaced, as in components/evaluation-page.test.tsx; the page,
// the contact form, the activation policy and the static worksheets are the real ones.
vi.mock("@/components/public-site-chrome", () => ({ PublicSiteHeader: () => null, PublicSiteFooter: () => null }));

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(packageRoot, "public");

const LOCALES = {
  en: {
    file: "pilot-worksheet.en.md",
    download: "tavonel-pilot-worksheet.en.md",
    korean: false,
    title: "# TAVONEL Pilot Evidence Worksheet",
    version: "- Version: 1",
    locale: "- Locale: en",
    notProvided: "Not provided",
    notRun: "Not run",
    notReviewed: "Not reviewed",
    unconfirmed: "UNCONFIRMED",
    noAttempts: "N/A — no attempts",
    linkLabel: "Download the blank pilot evidence worksheet (Markdown, English)",
    noStart: "Downloading it only retrieves the blank file: it does not start processing, enable a connection, or create a payment.",
    denominator: ["all attempts", "failed", "refused", "unanswered", "not only the answers that succeeded"],
    notAgreement: "not a permission, a signature, or a verified license",
    noPreset: "sets no price, credit, provider, or quota",
    noDeletion: "It does not delete, revoke, or promise anything.",
    fields: [
      "Logical document ID", "Source version", "Content hash", "Rights reference",
      "Expected answer (written by a person)", "Evidence anchor", "Independent review status",
      "Baseline", "Candidate", "System or model", "Version", "Input snapshot ID", "Where the configuration came from",
      "Change to be made", "Expected change in the answer or its evidence",
      "What was missing or unsupported", "Rejection reason", "Would the team reuse these answers?", "Purchase intent",
    ],
    limits: [
      "separate question from whether the answers are correct and useful",
      "Neither of them shows a benefit for your business.",
      "benchmark scores, research results, mirrored data, and patent data are not results for this pilot",
    ],
  },
  ko: {
    file: "pilot-worksheet.ko.md",
    download: "tavonel-pilot-worksheet.ko.md",
    korean: true,
    title: "# TAVONEL 파일럿 근거 기록지",
    version: "- 버전: 1",
    locale: "- 언어: ko",
    notProvided: "미작성",
    notRun: "미실행",
    notReviewed: "검토 전",
    unconfirmed: "미확인 (UNCONFIRMED)",
    noAttempts: "해당 없음 — 시도 없음",
    linkLabel: "빈 파일럿 근거 기록지 내려받기 (Markdown, 한국어)",
    noStart: "내려받기는 빈 파일을 받아 오는 것일 뿐 자료 처리, 외부 연결, 결제를 시작하지 않습니다.",
    denominator: ["모든 시도", "실패", "거절", "무응답", "성공한 답변만이 아니라"],
    notAgreement: "허가, 서명, 검증된 라이선스가 되지는 않습니다",
    noPreset: "가격, 크레딧, 제공업체, 사용 한도를 정하지 않습니다",
    noDeletion: "삭제나 권한 회수를 실행하거나 약속하지 않습니다.",
    fields: [
      "논리 문서 ID", "원문 버전", "내용 해시", "권리 근거",
      "기대 답변 (사람이 작성)", "근거 위치", "독립 검토 상태",
      "기준 구성", "비교 구성", "시스템 또는 모델", "버전", "입력 스냅샷 ID", "구성의 출처",
      "적용할 변경", "답변이나 근거에서 기대하는 변화",
      "누락되었거나 뒷받침되지 않은 내용", "반려 사유", "팀이 이 답변을 다시 사용할 것인가", "구매 의향",
    ],
    limits: [
      "답변이 정확하고 쓸모 있는지와 별개의 질문입니다",
      "둘 다 귀사 업무에 실제 이익이 있다는 근거는 아닙니다.",
      "벤치마크 점수, 연구 결과, 미러 데이터, 특허 데이터는 이번 파일럿의 결과가 아닙니다",
    ],
  },
} as const;
type Locale = keyof typeof LOCALES;
const LOCALE_KEYS = Object.keys(LOCALES) as Locale[];

function worksheetBytes(locale: Locale) {
  return readFileSync(path.join(publicDir, "evaluation", LOCALES[locale].file));
}
function worksheet(locale: Locale) {
  return new TextDecoder("utf-8", { fatal: true }).decode(worksheetBytes(locale));
}
function render(locale: Locale) {
  return renderToStaticMarkup(createElement(EvaluationPage, { korean: LOCALES[locale].korean }));
}

/** The body of the numbered `## n.` section, up to the next `## ` heading (subsections stay in). */
function section(text: string, n: number) {
  const chunk = text.split(/^## /m).find((part) => part.startsWith(`${n}. `));
  if (!chunk) throw new Error(`section ${n} is missing`);
  return chunk.slice(chunk.indexOf("\n") + 1);
}

/** Every table body row as trimmed cells; header and separator rows are skipped. */
function tableRows(text: string) {
  const rows: string[][] = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    const isRow = line.trimStart().startsWith("|");
    if (isRow && inTable && !/^\|\s*-/.test(line.trim())) rows.push(line.trim().split("|").slice(1, -1).map((cell) => cell.trim()));
    inTable = isRow;
  }
  return rows;
}

/** Every anchor that points at a pilot worksheet, with its attributes and its text. */
function worksheetAnchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .map(([, attrs, label]) => ({ attrs: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v] as const)), label, raw: attrs }))
    .filter((anchor) => /pilot-worksheet/.test(anchor.attrs.href ?? ""));
}

describe("pilot evaluation worksheet: native same-origin download link", () => {
  for (const locale of LOCALE_KEYS) {
    const other = locale === "en" ? "ko" : "en";
    it(`offers exactly the ${locale} worksheet as a plain download on the ${locale} page`, () => {
      const anchors = worksheetAnchors(render(locale));
      expect(anchors).toHaveLength(1);
      const [anchor] = anchors;
      expect(anchor.attrs.href).toBe(`/evaluation/${LOCALES[locale].file}`);
      expect(anchor.attrs.download).toBe(LOCALES[locale].download);
      expect(anchor.attrs.type).toBe("text/markdown");
      expect(anchor.label).toBe(LOCALES[locale].linkLabel);
      expect(anchor.raw).not.toContain(LOCALES[other].file);
    });
    it(`keeps the ${locale} link same-origin, inert and backed by a real static file`, () => {
      const [anchor] = worksheetAnchors(render(locale));
      expect(anchor.attrs.href.startsWith("/")).toBe(true);
      expect(anchor.attrs.href.startsWith("//")).toBe(false);
      expect(anchor.attrs.href).not.toMatch(/[:?#]/);
      for (const attribute of ["target", "rel", "onclick", "ping", "referrerpolicy"]) expect(anchor.attrs).not.toHaveProperty(attribute);
      expect(existsSync(path.join(publicDir, ...anchor.attrs.href.split("/").filter(Boolean)))).toBe(true);
    });
  }
});

describe("pilot evaluation worksheet: blank UTF-8 template with version and required record fields", () => {
  for (const locale of LOCALE_KEYS) {
    it(`${locale}: is bounded, BOM-free strict UTF-8 that round-trips byte for byte`, () => {
      const bytes = worksheetBytes(locale);
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes.length).toBeLessThan(32 * 1024);
      expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
      expect(Buffer.from(worksheet(locale), "utf-8").equals(bytes)).toBe(true);
      if (locale === "ko") expect(worksheet(locale)).toMatch(/[가-힣]/);
    });
    it(`${locale}: states its title, version 1, locale and BLANK — NOT RUN status up front`, () => {
      const lines = worksheet(locale).split("\n");
      expect(lines[0]).toBe(LOCALES[locale].title);
      const header = lines.slice(0, 6);
      expect(header).toContain(LOCALES[locale].version);
      expect(header).toContain(LOCALES[locale].locale);
      expect(header.some((line) => line.includes("BLANK — NOT RUN"))).toBe(true);
    });
    it(`${locale}: has all twelve record sections and every table cell is still an explicit placeholder`, () => {
      const text = worksheet(locale);
      for (let n = 1; n <= 12; n++) expect(() => section(text, n)).not.toThrow();
      const { notProvided, notRun, notReviewed, unconfirmed } = LOCALES[locale];
      const placeholders: string[] = [notProvided, notRun, notReviewed, unconfirmed];
      const rows = tableRows(text);
      expect(rows.length).toBeGreaterThan(30);
      for (const row of rows) for (const cell of row.slice(1)) expect(placeholders).toContain(cell);
      const stopping = section(text, 7).split("\n").filter((line) => line.startsWith("- "));
      expect(stopping.length).toBeGreaterThanOrEqual(4);
      for (const line of stopping) expect(line.endsWith(`: ${notProvided}`)).toBe(true);
      expect(section(text, 5).trimEnd().endsWith(`: ${notProvided}`)).toBe(true);
    });
    it(`${locale}: contains no fabricated measurement — no zero defaults, percentages or amounts`, () => {
      const text = worksheet(locale);
      expect(text).not.toMatch(/\|\s*0(?:[.,]0+)?\s*\|/);
      expect(text).not.toMatch(/:\s*0(?:[.,]0+)?\s*$/m);
      expect(text).not.toMatch(/\d\s*%/);
      expect(text).not.toMatch(/[$€£¥₩]\s*\d/);
      expect(text).not.toMatch(/\d\s*(?:USD|KRW|EUR|원|credits?|크레딧)/i);
      expect(text).not.toMatch(/\b(?:passed|achieved|improved by|outperform)/i);
    });
  }
  it("keeps the English and Korean editions structurally parallel", () => {
    const [en, ko] = LOCALE_KEYS.map(worksheet);
    expect(en.match(/^## /gm)?.length).toBe(ko.match(/^## /gm)?.length);
    expect(en.match(/^### /gm)?.length).toBe(ko.match(/^### /gm)?.length);
    expect(en.match(/^- \[ \] /gm)?.length).toBe(ko.match(/^- \[ \] /gm)?.length);
    for (let n = 1; n <= 12; n++) expect(tableRows(section(ko, n)).map((r) => r.length)).toEqual(tableRows(section(en, n)).map((r) => r.length));
  });
});

describe("pilot evaluation worksheet: every attempt is the denominator and nothing is pre-credited", () => {
  for (const locale of LOCALE_KEYS) {
    it(`${locale}: defines the denominator as all attempts, including failed, refused and unanswered`, () => {
      const ledger = section(worksheet(locale), 8);
      for (const phrase of LOCALES[locale].denominator) expect(ledger).toContain(phrase);
      expect(ledger).toContain("NOT RUN");
      expect(ledger).toContain(LOCALES[locale].noAttempts);
    });
    it(`${locale}: ledger rows separate refused, failed, unanswered and unsupported outcomes and are all unrun`, () => {
      const rows = tableRows(section(worksheet(locale), 8));
      const outcomes = rows.map((row) => row[0]);
      const expected = locale === "en"
        ? ["Attempts (the denominator)", "Refused", "Failed (error or timeout)", "Unanswered", "Correct but not supported by the cited evidence", "Marked uncertain by the system", "Cost (unit and currency stated)", "Time per attempt (unit stated)", "Support effort (people and time)"]
        : ["시도 수 (분모)", "거절", "실패 (오류 또는 시간 초과)", "무응답", "정답이지만 인용한 근거가 뒷받침하지 않음", "시스템이 불확실하다고 표시함", "비용 (단위와 통화 명시)", "시도당 시간 (단위 명시)", "지원에 든 노력 (인원과 시간)"];
      for (const outcome of expected) expect(outcomes).toContain(outcome);
      for (const row of rows) for (const cell of row.slice(1)) expect(cell).toBe(LOCALES[locale].notRun);
    });
    it(`${locale}: forbids zero as a placeholder and a percentage for an empty denominator`, () => {
      const guide = worksheet(locale).split(/^## /m)[2];
      expect(guide).toContain(locale === "en" ? "Never enter 0 as a placeholder." : "자리 표시로 0을 적지 마세요.");
      expect(guide).toContain(LOCALES[locale].noAttempts);
      expect(guide).toContain(locale === "en" ? "Do not write a percentage for it." : "백분율을 적지 마세요.");
    });
  }
});

describe("pilot evaluation worksheet: rights, scope, cost, retention and exit stay unconfirmed; live gates unchanged", () => {
  for (const locale of LOCALE_KEYS) {
    it(`${locale}: rights, comparison, cost and exit sections are UNCONFIRMED and only placeholders`, () => {
      const text = worksheet(locale);
      for (const n of [2, 5, 7, 11]) expect(section(text, n)).toMatch(/^(?:Status|상태): .*UNCONFIRMED/m);
      expect(section(text, 2)).toContain(LOCALES[locale].notAgreement);
      for (const row of tableRows(section(text, 2))) expect(row[1]).toBe(LOCALES[locale].notProvided);
    });
    it(`${locale}: presets no price, currency amount, credit, provider or quota`, () => {
      const cost = section(worksheet(locale), 7);
      expect(cost).toContain(LOCALES[locale].noPreset);
      expect(cost).not.toMatch(/\d/);
      for (const row of tableRows(cost)) expect([LOCALES[locale].notProvided, LOCALES[locale].unconfirmed]).toContain(row[1]);
    });
    it(`${locale}: the exit checklist names who verifies without executing or promising deletion`, () => {
      const exit = section(worksheet(locale), 11);
      expect(exit).toContain(LOCALES[locale].noDeletion);
      const rows = tableRows(exit);
      expect(rows.length).toBeGreaterThanOrEqual(6);
      for (const row of rows) expect(row.at(-1)).toBe(LOCALES[locale].unconfirmed);
      expect(exit).not.toMatch(/\b(?:has been|have been|was|were) (?:deleted|revoked)\b|\bguarantee/i);
    });
  }
  it("leaves the promotion gate closed; customer data is open only by the P2-37 switch (register D-12)", () => {
    expect(activationPolicy.customerData.enabled).toBe(true);
    expect(activationPolicy.candidatePromotion.enabled).toBe(false);
  });
});

describe("pilot evaluation worksheet: provenance, ground truth, change, support and reuse are record fields, not proof", () => {
  for (const locale of LOCALE_KEYS) {
    it(`${locale}: names every record field a customer has to fill in`, () => {
      const text = worksheet(locale);
      for (const field of LOCALES[locale].fields) expect(text).toContain(field);
    });
    it(`${locale}: manifest, ground truth, comparison and change fields arrive empty and unreviewed`, () => {
      const text = worksheet(locale);
      for (const n of [3, 5]) for (const row of tableRows(section(text, n))) for (const cell of row.slice(1)) expect(cell).toBe(LOCALES[locale].notProvided);
      expect(tableRows(section(text, 4))[0].at(-1)).toBe(LOCALES[locale].notReviewed);
      expect(tableRows(section(text, 6)).at(-1)?.[1]).toBe(LOCALES[locale].notRun);
      expect(section(text, 10)).toMatch(/UNMEASURED/);
    });
    it(`${locale}: separates structure from quality and keeps outside data out of the results`, () => {
      const limits = section(worksheet(locale), 12);
      for (const phrase of LOCALES[locale].limits) expect(limits).toContain(phrase);
    });
    it(`${locale}: carries no URL, markup, command, contact, key or file path`, () => {
      const text = worksheet(locale);
      expect(text).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
      expect(text).not.toMatch(/www\./i);
      expect(text).not.toMatch(/<\/?[a-z!]/i);
      expect(text).not.toContain("```");
      expect(text).not.toMatch(/\b(?:curl|wget|npm|pnpm|npx|python|bash|powershell)\b/i);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      expect(text).not.toMatch(/\b(?:sk|pk|rk)[-_][A-Za-z0-9]{8,}/);
      expect(text).not.toMatch(/[A-Za-z]:\\|(?:^|\s)\/(?:home|Users|var|etc|tmp)\//m);
    });
  }
});

describe("pilot evaluation worksheet: the real EvaluationPage keeps its form, gates and links", () => {
  for (const locale of LOCALE_KEYS) {
    it(`${locale}: still renders one form with exactly three required fields and the inquiry boundary`, () => {
      const html = render(locale);
      expect(html.match(/<form\b/g)?.length).toBe(1);
      expect((html.match(/ required=""/g) ?? []).length).toBe(3);
      expect(html).toContain(locale === "en" ? "An inquiry does not start processing" : "문의를 보내도 자료 처리");
      expect(html).toContain(locale === "en" ? "Please do not include private documents or credentials." : "비공개 문서나 인증 정보는 넣지 마세요.");
      expect(html).toContain('aria-labelledby="evaluation-request-title"');
    });
    it(`${locale}: places the download in the intro, outside the form, with its no-processing statement`, () => {
      const html = render(locale);
      const anchorAt = html.indexOf(`href="/evaluation/${LOCALES[locale].file}"`);
      expect(anchorAt).toBeGreaterThan(html.indexOf('class="evaluation-intro"'));
      expect(anchorAt).toBeLessThan(html.indexOf('class="evaluation-grid"'));
      expect(anchorAt).toBeLessThan(html.indexOf("<form"));
      expect(html).toContain(LOCALES[locale].noStart);
    });
    it(`${locale}: keeps locale, public sample, pricing and customer-data gate copy`, () => {
      const html = render(locale);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain('href="/explore"');
      expect(html).toContain(locale === "en" ? 'href="/pricing"' : 'href="/ko/pricing"');
      expect(html).toContain(locale === "en" ? "rather than enabled by a plan purchase" : "요금제 구매가 아니라 저희와 함께 설정합니다");
      expect(html).not.toMatch(/<script\b/);
    });
  }
  it("adds no client state, event handler, storage, analytics or network call to the page source", () => {
    const source = readFileSync(path.join(packageRoot, "components", "evaluation-page.tsx"), "utf-8");
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(/\bon[A-Z]\w*=/);
    expect(source).not.toMatch(/\buse(?:State|Effect|Ref|Reducer|Transition)\b/);
    expect(source).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon|trackFunnel\w*)\b/);
    expect(source.match(/download="tavonel-pilot-worksheet\.(?:en|ko)\.md"/g)).toHaveLength(2);
  });
});

// Following the link is an ordinary request for the blank file, so the copy only says what a download
// and a filled-in local copy do not submit. It makes no claim that no request or information is sent.
const RETRIEVAL = {
  en: {
    status: "- Status: BLANK — NOT RUN",
    page: ["Downloading it only retrieves the blank file:", "Filling in your copy does not by itself send what you write to us."],
    sheet: [
      "Downloading it only retrieves this blank file.",
      "Neither downloading nor filling it in starts processing, enables a connection, or creates a payment.",
      "Filling it in does not by itself send what you write to TAVONEL.",
    ],
  },
  ko: {
    status: "- 상태: BLANK — NOT RUN (빈 양식, 미실행)",
    page: ["내려받기는 빈 파일을 받아 오는 것일 뿐", "내려받은 파일을 작성하는 것만으로는 그 내용이 저희에게 전송되지 않습니다."],
    sheet: [
      "내려받기는 이 빈 파일을 받아 오는 것일 뿐입니다.",
      "내려받거나 작성해도 자료 처리, 외부 연결, 결제가 시작되지 않으며",
      "작성하는 것만으로 그 내용이 TAVONEL에 전송되지는 않습니다.",
    ],
  },
} as const;
const SUPERSEDED = ["send us any information", "send anything to TAVONEL", "no request to us", "어떤 정보도 저희에게 전송되지 않습니다", "TAVONEL에 아무것도 전송되지 않습니다"];
const GENERIC_PROMISE = /no information|any information|no request|no network|no analytics|telemetry|어떤 정보도|아무것도 전송|요청이 없|요청을 보내지/i;
const OTHER_EDITION = ["Korean edition", "English edition", "same page", "영문판", "한국어판", "같은 페이지"];

describe("pilot worksheet copy correction: download retrieval boundary and single-locale worksheet header", () => {
  for (const locale of LOCALE_KEYS) {
    const other = locale === "en" ? "ko" : "en";
    it(`${locale}: page and worksheet say a download retrieves the blank file and filling it in does not by itself submit its contents`, () => {
      const html = render(locale);
      const intro = html.slice(html.indexOf('class="evaluation-intro"'), html.indexOf('class="evaluation-grid"'));
      const text = worksheet(locale);
      const about = text.split(/^## /m)[1];
      for (const phrase of RETRIEVAL[locale].page) expect(intro).toContain(phrase);
      expect(intro).toContain(LOCALES[locale].noStart);
      for (const phrase of RETRIEVAL[locale].sheet) expect(about).toContain(phrase);
      for (const body of [html, text]) for (const phrase of SUPERSEDED) expect(body).not.toContain(phrase);
      for (const body of [intro, about]) expect(body).not.toMatch(GENERIC_PROMISE);
      const source = readFileSync(path.join(packageRoot, "components", "evaluation-page.tsx"), "utf-8");
      expect(source).toContain("an ordinary GET that retrieves the blank static file; it submits no worksheet or form contents");
      expect(source).not.toContain("no request to us");
    });
    it(`${locale}: worksheet header promises no other-language edition and the page offers only its own native download`, () => {
      const text = worksheet(locale);
      expect(text.split("\n").slice(0, 6)).toEqual([LOCALES[locale].title, "", LOCALES[locale].version, LOCALES[locale].locale, RETRIEVAL[locale].status, ""]);
      for (const phrase of OTHER_EDITION) expect(text).not.toContain(phrase);
      for (let n = 1; n <= 12; n++) expect(() => section(text, n)).not.toThrow();
      for (const field of LOCALES[locale].fields) expect(text).toContain(field);
      const html = render(locale);
      const anchors = worksheetAnchors(html);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].attrs).toMatchObject({ href: `/evaluation/${LOCALES[locale].file}`, download: LOCALES[locale].download, type: "text/markdown" });
      expect(anchors[0].label).toBe(LOCALES[locale].linkLabel);
      expect(html).not.toContain(LOCALES[other].file);
      expect(html).not.toContain(LOCALES[other].download);
    });
  }
});
