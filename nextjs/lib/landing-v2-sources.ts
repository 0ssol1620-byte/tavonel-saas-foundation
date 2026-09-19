import { exploreSampleDocuments } from "./explore-sample";
import { LANDING_V2_IMAGES, type LandingV2Image } from "./landing-v2-assets";
import { KO_TERMS } from "./ko-terms";
import { landingV2Copy } from "./landing-v2-copy";
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../shared/capabilityManifest";

/**
 * Scene 03's data and its scene-local labels (blueprint §13, §2.4).
 *
 * SERVER ONLY, for the reason `lib/landing-v2-proof.ts` gives: it reads `lib/explore-sample.ts`,
 * which runs the collection compiler at module scope.
 *
 * WHY THIS FILE EXISTS AT ALL. `lib/landing-v2-copy.ts` types the `sources` scene as a bare
 * `LandingV2Scene` -- eyebrow, headline, support, note -- and Scene 03 needs five more things
 * that module does not carry: the object vocabulary the compiler emits, the two words on the
 * compiler block, the sentence that names the result after the visual, this scene's next action,
 * and alt text for a page preview. The lane that owns the copy deck is not this one, so the
 * additions land here and are reported rather than edited into a module another lane is writing.
 *
 * NOTHING BELOW IS A SECOND SPELLING OF A PUBLISHED STRING. The accepted-format sentence is
 * `describeAcceptedFormats(CAPABILITY_MANIFEST)` -- the one /sources, /docs and the hero already
 * print -- and `pageOfFormat` is read back off the hero's own copy, so the landing states a page
 * position one way in two scenes.
 */

/* ------------------------------------------------------------------------------------- facts */

export type SourcesThumb = {
  documentId: string;
  /** The file the compiler read, as the source record spells it. */
  filename: string;
  form: string;
  filingDate: string;
  /** Which page of this filing the committed derivative is of. */
  page: number;
  pageCount: number;
  /** `original` or `reference_render`; the caption qualifies the raster with it. */
  representationKind: string;
  raster: { src: string; srcSet: string; width: number; height: number };
};

export type SourcesSceneData = {
  /** One committed page preview per filing, in arrival order. Never more than three. */
  stack: SourcesThumb[];
  /** What this deployment accepts at upload, derived from the capability manifest. */
  acceptedFormats: string;
};

const STACK_LIMIT = 3;

/** The lowest-numbered page of this source that the build emitted a whole-page derivative for. */
function firstPageImage(digest: string): LandingV2Image | null {
  return (
    LANDING_V2_IMAGES.filter((image) => image.kind === "page" && image.sourceSha256 === digest).sort(
      (left, right) => left.page - right.page,
    )[0] ?? null
  );
}

/**
 * The source stack: real filings, real filenames, real committed page renders.
 *
 * The selection rule is the one Scene 02's tabs also use, and it has a single requirement a
 * reader can see: a filing is in the stack only if this repository holds a rendered page of it.
 * §13 asks the stack to say "bring the mess" -- a spreadsheet, a deck, a scan -- and this World
 * holds none of those, so the stack shows what the World actually holds and the breadth claim is
 * made by the accepted-format sentence underneath it, where it has a receipt (contract rules 2
 * and 7). A drawn `pricing.xlsx` beside three real filings would be the one synthetic pixel §21
 * exists to prevent.
 *
 * Arrival order, by filing date, because that is the order the compiler met them in and the
 * order Scene 05 compares its snapshots in.
 */
export function buildSourcesScene(): SourcesSceneData {
  const stack: SourcesThumb[] = [];
  const byArrival = [...exploreSampleDocuments].sort((left, right) => left.filingDate.localeCompare(right.filingDate));
  for (const document of byArrival) {
    const image = firstPageImage(document.digest);
    if (!image) continue;
    stack.push({
      documentId: document.documentId,
      filename: document.filename,
      form: document.form,
      filingDate: document.filingDate,
      page: image.page,
      pageCount: document.pageCount,
      representationKind: document.representationKind,
      raster: { src: image.src, srcSet: image.srcSet, width: image.width, height: image.height },
    });
    if (stack.length === STACK_LIMIT) break;
  }
  if (stack.length === 0) throw new Error("landing_v2_sources_has_no_committed_page_preview");
  return { stack, acceptedFormats: describeAcceptedFormats(CAPABILITY_MANIFEST) };
}

/*
  Read once per process, like `heroScene()` in `components/landing-v2/landing-page.tsx`. The
  World behind it is frozen at build time and the builder is pure over it, so there is nothing a
  cache would have to invalidate.
*/
let memo: SourcesSceneData | undefined;
export function sourcesScene(): SourcesSceneData {
  return (memo ??= buildSourcesScene());
}

/* ------------------------------------------------------------------------------------- words */

export type SourcesObject = { id: string; label: string; note: string };

export type SourcesCopy = {
  stackLabel: string;
  formatsLabel: string;
  /** The two mono lines on the compiler block. The product name is not translated. */
  compilerLines: readonly [string, string];
  objectsLabel: string;
  objects: readonly SourcesObject[];
  /** §2.4: the visual is shown first and named afterwards. This is the naming. */
  naming: string;
  next: { label: string; href: string };
  /** Alt text for a page preview, by representation kind. No figure in it (contract rule 4). */
  alt: { original: string; reference: string };
  /** The hero's own page connective, read back rather than respelled. */
  pageOfFormat: string;
};

/*
  THE SIX OBJECT TYPES, and where each one is in the World rather than in a slide.

  Entities and Claims are `VisualNode.kind`; Relations are `edges[].predicate`; Evidence is
  `VisualEvidence` -- the filename, page and per-mille box a passage was read from; Versions is
  the `sourceVersionId` / source digest an object is bound to; Retrieval is the Ask path, which
  `lib/explore-sample.ts` publishes as prepared questions with grounded citations. Each note says
  what the object holds and never how well it holds it: there is no figure in these chips and no
  quality word.
*/
const EN_OBJECTS: readonly SourcesObject[] = [
  { id: "entities", label: "Entities", note: "The named things a source refers to." },
  { id: "claims", label: "Claims", note: "What a source states, in the words it printed." },
  { id: "relations", label: "Relations", note: "How one object reaches another, with the predicate kept." },
  { id: "evidence", label: "Evidence", note: "The file, the page and the region a passage was read from." },
  { id: "versions", label: "Versions", note: "Which version of which source an object is bound to." },
  { id: "retrieval", label: "Retrieval", note: "What an Ask returns, with the regions it cites." },
];

/*
  C5, 2026-09-19. These six chips carried their ENGLISH labels on /ko while Scene 04 above them
  called the same thing 근거 and printed Korean field names -- one page, two names for one noun.
  Every label is now read out of `KO_TERMS`, so the spelling cannot drift from the rest of the
  Korean site and a reviewer who disagrees with one changes it in a single place.
*/
const KO_OBJECTS: readonly SourcesObject[] = [
  { id: "entities", label: KO_TERMS.entity, note: "원문이 가리키는 이름 있는 대상입니다." },
  { id: "claims", label: KO_TERMS.claim, note: "원문이 인쇄한 문장 그대로 진술한 내용입니다." },
  { id: "relations", label: KO_TERMS.relation, note: "한 객체가 다른 객체에 닿는 방식이며, 술어가 함께 남습니다." },
  { id: "evidence", label: KO_TERMS.evidence, note: "문단을 읽어 온 파일과 페이지와 영역입니다." },
  { id: "versions", label: KO_TERMS.revision, note: "객체가 어느 원문의 어느 버전에 묶여 있는지입니다." },
  { id: "retrieval", label: KO_TERMS.retrieval, note: "Ask가 돌려주는 내용과 그것이 인용한 영역입니다." },
];

/*
  The next action is a deep link into the World act of /explore, not a second Explore action:
  contract rule 6 keeps one Explore action (`EXPLORE_CTA`), and
  `components/landing-v2/scene-actions.ts` already opens /explore?act=evidence from Scene 04 in
  exactly this way. `act=world` is a member of `DEEP_LINK_ACTS` in `lib/explore-story.ts`.
*/
export const SOURCES_COPY: Record<"en" | "ko", SourcesCopy> = {
  en: {
    stackLabel: "SOURCES COMPILED HERE",
    formatsLabel: "Accepted at upload",
    compilerLines: ["TAVONEL", "COMPILER"],
    objectsLabel: "OBJECTS",
    objects: EN_OBJECTS,
    naming: "What comes out is a Compiled World.",
    next: { label: "See the World view", href: "/explore?act=world" },
    alt: {
      original: "A page of the original filing, as the compiler read it.",
      reference: "A reference render of the filing page, as the compiler read it.",
    },
    pageOfFormat: landingV2Copy(false).hero.pageOfFormat,
  },
  ko: {
    stackLabel: "여기서 컴파일한 원문",
    formatsLabel: "업로드에서 허용하는 형식",
    compilerLines: ["TAVONEL", "컴파일러"],
    objectsLabel: "객체",
    objects: KO_OBJECTS,
    naming: "나오는 것이 Compiled World입니다.",
    next: { label: "World 뷰 보기", href: "/explore?act=world" },
    alt: {
      original: "컴파일러가 읽은 그대로의 원본 공시 페이지입니다.",
      reference: "컴파일러가 읽은 그대로의 공시 페이지 기준 렌더입니다.",
    },
    pageOfFormat: landingV2Copy(true).hero.pageOfFormat,
  },
};

/** `{key}` substitution, the same one `hero-compiler-demo.tsx` uses: a missing key stays visible. */
export function fillSourcesFormat(format: string, values: Record<string, string | number>): string {
  return format.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
