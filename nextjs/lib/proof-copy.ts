/**
 * The source-proof block's own words, in the two languages this site publishes.
 *
 * BQ-063 / n34. `/ko` is the site's one Korean URL and it rendered the proof block entirely in
 * English: the filing label, the ledger's field names, the page caption, the zoom controls and
 * the two sentences that say whether the bytes have been checked yet. A Korean reader met the
 * one block on the page whose argument is "this is the real source" and could not read what it
 * said about the source.
 *
 * The rule is the one `lib/ko-terms.ts` sets and `CompileStagePlayer` already follows: a locale
 * picks a record, English is the default, and no English string moves -- so `/explore`, the
 * solution pages and every e2e selector built on them are untouched. Korean spellings come from
 * `KO_TERMS` (원문 for source, 근거 for evidence, 컴파일 for compile, Compiled World kept in
 * English because it names an artifact a reader also meets in a filename and a digest), and
 * `lib/ko-terms.test.ts` runs `koTermDrift` over this file.
 *
 * What is deliberately not here: the messages thrown inside the live PDF check. Those name a
 * technical failure of a fetch, a hash comparison or a page count to whoever is diagnosing it,
 * they are not a translation of a published English sentence, and inventing Korean for a failure
 * mode is how a translated page starts making claims the English page does not.
 */

export type ProofLocale = "en" | "ko";

type ProofStrings = {
  /** The canonical block: its figcaption, its link out, and the objects beat. */
  head: string;
  inspect: string;
  linkedObjects: string;
  /** The excerpt and crop variants. */
  fromSource: string;
  openRegion: string;
  filed: (date: string) => string;
  page: (page: number) => string;
  pageOf: (page: number, pageCount: number) => string;
  counts: (filings: number, pages: string, regions: string) => string;
  /** The source sheet. */
  passageLabel: string;
  cropCaption: string;
  cropAlt: (page: number) => string;
  verify: string;
  fieldFiling: string;
  fieldReadFrom: string;
  fieldSource: string;
  fieldRegion: string;
  fieldAccession: string;
  fieldAuthority: string;
  bbox: string;
  edgarPrimary: string;
  asRead: string;
  fullyCompiled: (pageCount: number) => string;
  slice: (compiled: number, pageCount: number) => string;
  openQualified: (qualifier: string) => string;
  openAcquired: string;
  verifyOnSec: string;
  /** The live source page. */
  pageControls: string;
  zoomOut: string;
  fitPage: string;
  zoomIn: string;
  highlight: string;
  viewportSelectable: string;
  viewportPlain: string;
  pageAlt: (filename: string, page: number, pageCount: number) => string;
  canvasAlt: (filename: string, page: number, pageCount: number) => string;
  loadingPage: string;
  checkUnfinished: string;
  committedFallback: string;
  checkAgain: string;
  bytesVerified: string;
  committedVerifying: string;
  verifying: string;
  rotated: string;
};

export const PROOF_COPY: Record<ProofLocale, ProofStrings> = {
  en: {
    head: "Public compiled World · Apple SEC corpus",
    inspect: "Inspect the evidence",
    linkedObjects: "Objects compiled from this region",
    fromSource: "From the source",
    openRegion: "Open this region on /explore",
    filed: (date) => `filed ${date}`,
    page: (page) => `page ${page}`,
    pageOf: (page, pageCount) => `page ${page} of ${pageCount}`,
    counts: (filings, pages, regions) => `${filings} filings · ${pages} pages · ${regions} regions`,
    passageLabel: "What the compiler read from this page",
    cropCaption: "The highlighted region above, at twice its size.",
    cropAlt: (page) => `The region of page ${page} this passage was read from`,
    verify: "Verify this source",
    fieldFiling: "Filing",
    fieldReadFrom: "Read from",
    fieldSource: "Source",
    fieldRegion: "Region",
    fieldAccession: "Accession",
    fieldAuthority: "Authority",
    bbox: "bbox, per mille of the page",
    edgarPrimary: "SEC EDGAR primary document",
    asRead: "This page, as the compiler read it",
    fullyCompiled: (pageCount) => `Full filing compiled · ${pageCount} pages`,
    slice: (compiled, pageCount) => `Curated page slice · ${compiled} of ${pageCount} pages compiled`,
    openQualified: (qualifier) => `Open the ${qualifier}`,
    openAcquired: "Open the acquired original",
    verifyOnSec: "Verify on SEC",
    pageControls: "Source page controls",
    zoomOut: "Zoom out",
    fitPage: "Fit page",
    zoomIn: "Zoom in",
    highlight: "Highlight",
    viewportSelectable:
      "Source page; use the zoom controls to read it and the extracted passage beside it to select a region",
    viewportPlain: "Source page; use the zoom controls to read it",
    pageAlt: (filename, page, pageCount) => `${filename}, page ${page} of ${pageCount}`,
    canvasAlt: (filename, page, pageCount) => `${filename}, PDF page ${page} of ${pageCount}`,
    loadingPage: "Loading the source page…",
    checkUnfinished: "The live check of this file did not finish",
    committedFallback: " The page above is our stored copy of the same source.",
    checkAgain: "Check again",
    bytesVerified: "Source bytes verified in this browser",
    committedVerifying: "Showing our stored copy of this page while we re-check the source bytes",
    verifying: "Verifying the source bytes",
    rotated: "This rotated page is shown without a region overlay.",
  },
  ko: {
    head: "공개 Compiled World · Apple SEC 자료",
    inspect: "근거 확인",
    linkedObjects: "이 영역에서 컴파일된 객체",
    fromSource: "원문에서",
    openRegion: "이 영역을 /explore에서 열기",
    filed: (date) => `${date} 제출`,
    page: (page) => `${page}쪽`,
    pageOf: (page, pageCount) => `전체 ${pageCount}쪽 중 ${page}쪽`,
    counts: (filings, pages, regions) => `문서 ${filings}건 · ${pages}페이지 · 영역 ${regions}개`,
    passageLabel: "컴파일러가 이 페이지에서 읽은 내용",
    cropCaption: "위에 표시된 영역을 두 배로 확대한 이미지입니다.",
    cropAlt: (page) => `이 문장을 읽어 온 ${page}쪽의 영역`,
    verify: "원문 검증",
    fieldFiling: "문서",
    fieldReadFrom: "읽은 대상",
    fieldSource: "원문",
    fieldRegion: "영역",
    fieldAccession: "접수번호",
    fieldAuthority: "출처",
    bbox: "bbox, 페이지 기준 천분율",
    edgarPrimary: "SEC EDGAR 원본 문서",
    asRead: "컴파일러가 읽은 그대로의 페이지",
    fullyCompiled: (pageCount) => `전체 문서 컴파일 · ${pageCount}페이지`,
    slice: (compiled, pageCount) => `선별된 페이지 · 전체 ${pageCount}페이지 중 ${compiled}페이지 컴파일`,
    openQualified: (qualifier) => `${qualifier} 열기`,
    openAcquired: "수집한 원본 열기",
    verifyOnSec: "SEC에서 확인",
    pageControls: "원문 페이지 조작",
    zoomOut: "축소",
    fitPage: "페이지 맞춤",
    zoomIn: "확대",
    highlight: "영역 표시",
    viewportSelectable: "원문 페이지입니다. 확대·축소로 읽고, 옆의 추출 문장에서 영역을 선택하세요.",
    viewportPlain: "원문 페이지입니다. 확대·축소로 읽으세요.",
    pageAlt: (filename, page, pageCount) => `${filename}, 전체 ${pageCount}쪽 중 ${page}쪽`,
    canvasAlt: (filename, page, pageCount) => `${filename}, PDF 전체 ${pageCount}쪽 중 ${page}쪽`,
    loadingPage: "원문 페이지를 불러오는 중…",
    checkUnfinished: "이 파일의 실시간 검증이 끝나지 않았습니다",
    committedFallback: " 위 페이지는 같은 원문을 저장해 둔 사본입니다.",
    checkAgain: "다시 확인",
    bytesVerified: "이 브라우저에서 원문 바이트를 검증했습니다",
    committedVerifying: "저장해 둔 사본을 보이는 중 · 원문 바이트 재검증 중",
    verifying: "원문 바이트 검증 중",
    rotated: "회전된 페이지여서 영역 표시 없이 보여줍니다.",
  },
};

/** The record a surface renders. English is the default, so no English string moves. */
export function proofCopy(korean?: boolean): ProofStrings {
  return korean ? PROOF_COPY.ko : PROOF_COPY.en;
}
