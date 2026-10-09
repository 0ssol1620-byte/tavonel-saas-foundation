/**
 * The reading, as the browser receives it.
 *
 * The progress object is written by the CDR worker while the OCR worker streams pages back. It is
 * mutable, it expires, and it is explicitly not evidence -- `ocr.json` is the record. This module
 * validates it before anything is drawn from it, for the ordinary reason that it arrives over the
 * network, and for a specific one: a viewer that trusts these numbers would happily draw a page
 * count of 40 for a document with 3 pages, and that is a lie the product cannot afford.
 *
 * It does carry the lines that were read, and that is deliberate. The object travels from the
 * bucket to the browser on a signed URL, so the customer's own document reaches the customer's
 * own screen without the application server being on the path -- which is the property the
 * product actually promises. What must never happen is this content being relayed through the
 * application: `app/api/documents/[id]/progress` never opens the object at all -- it decides who
 * may read it, signs a URL, and returns that. Keep it that way.
 */

export type ProgressBox = {
  /** [x0, y0, x1, y1] in a 0-1000 space, so it can be drawn without knowing the page size. */
  bbox1000: [number, number, number, number];
  confidence: number;
  /** The line the reader found here. Empty when the reader reported none. */
  text: string;
  regionId: string;
};

export type ProgressPage = {
  pageNumber1: number;
  pageCount: number;
  path: string;
  regionCount: number;
  meanConfidence: number;
  boxes: ProgressBox[];
};

/** Identity returned by the authorized progress route from its selected immutable inventory row. */
export type SourceVersionDescriptor = {
  documentId: string;
  versionKey: string;
  sourceImmutableKey: string;
  /** Digest of the sanitized PDF bytes that OCR reads, not the original uploaded source. */
  sourceSha256: string;
};

export type VerifiedSourceObservation = SourceVersionDescriptor & {
  pdfBytes: Uint8Array;
  progress: OcrProgress | null;
};

export type OcrProgress = {
  documentId: string;
  versionKey: string;
  sourceImmutableKey: string;
  sourceSha256: string;
  state: "reading" | "read" | "refused";
  pagesRead: number;
  pageCount: number | null;
  regionsFound: number;
  pages: ProgressPage[];
};

const SCHEMA = "tavonel.ocr_progress.v1";
const SHA256 = /^sha256:([a-f0-9]{64})$/i;

export function matchesSanitizedSourceDigest(expected: string, actual: string): boolean {
  return SHA256.test(expected) && SHA256.test(actual) && expected.toLowerCase() === actual.toLowerCase();
}

/** Qualifies only identity fields returned by the authorized progress route. */
export function qualifySourceVersionDescriptor(value: unknown, expectedDocumentId: string): SourceVersionDescriptor | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.documentId !== expectedDocumentId || typeof body.versionKey !== "string"
    || typeof body.sourceImmutableKey !== "string" || typeof body.sourceSha256 !== "string") return null;
  const descriptor = {
    documentId: body.documentId,
    versionKey: body.versionKey,
    sourceImmutableKey: body.sourceImmutableKey,
    sourceSha256: body.sourceSha256,
  } as SourceVersionDescriptor;
  return qualifiedDescriptor(descriptor) ? descriptor : null;
}

function number(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function qualifyPage(value: unknown): ProgressPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const pageCount = number(page.pageCount, 1, 100_000);
  const pageNumber1 = number(page.pageNumber1, 1, 100_000);
  const regionCount = number(page.regionCount, 0, 1_000_000);
  const meanConfidence = number(page.meanConfidence, 0, 1);
  if (pageCount === null || pageNumber1 === null || regionCount === null || meanConfidence === null) return null;
  if (pageNumber1 > pageCount) return null;
  const boxes = Array.isArray(page.boxes) ? page.boxes : [];
  return {
    pageNumber1,
    pageCount,
    path: typeof page.path === "string" ? page.path : "",
    regionCount,
    meanConfidence,
    boxes: boxes.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const box = entry as Record<string, unknown>;
      const bbox = Array.isArray(box.bbox1000) ? box.bbox1000 : [];
      if (bbox.length !== 4) return [];
      const values = bbox.map((v) => number(v, 0, 1000));
      if (values.some((v) => v === null)) return [];
      const [x0, y0, x1, y1] = values as number[];
      // A box that is inverted or empty cannot be drawn honestly, so it is not drawn at all.
      if (x1 <= x0 || y1 <= y0) return [];
      return [{
        bbox1000: [x0, y0, x1, y1] as [number, number, number, number],
        confidence: number(box.confidence, 0, 1) ?? 0,
        // Trimmed for display only. A line the reader did not find is empty, never invented.
        text: typeof box.text === "string" ? box.text.slice(0, 400) : "",
        regionId: typeof box.regionId === "string" ? box.regionId.slice(0, 256) : "",
      }];
    }),
  };
}

function qualifiedDescriptor(value: SourceVersionDescriptor): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(value.documentId)
    && /^[a-f0-9]{64}$/i.test(value.versionKey)
    && value.sourceImmutableKey.endsWith(`/${value.documentId}/${value.versionKey}/sanitized.pdf`)
    && matchesSanitizedSourceDigest(value.sourceSha256, `sha256:${value.versionKey}`);
}

/**
 * Returns null unless the mutable v1 observation matches the server-selected source version.
 * The descriptor must come from the authorized progress response and its digest must name the
 * sanitized PDF version. V1 objects without either binding field remain unbound and are not drawn.
 */
export function qualifyProgress(value: unknown, expected: SourceVersionDescriptor): OcrProgress | null {
  if (!qualifiedDescriptor(expected)) return null;
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.schemaVersion !== SCHEMA) return null;
  if (body.sourceImmutableKey !== expected.sourceImmutableKey || typeof body.inputSha256 !== "string"
    || !matchesSanitizedSourceDigest(expected.sourceSha256, body.inputSha256)) return null;
  if (body.state !== "reading" && body.state !== "read" && body.state !== "refused") return null;
  const pagesRead = number(body.pagesRead, 0, 100_000);
  const regionsFound = number(body.regionsFound, 0, 1_000_000);
  if (pagesRead === null || regionsFound === null) return null;
  const pageCount = body.pageCount === null ? null : number(body.pageCount, 1, 100_000);
  if (body.pageCount !== null && pageCount === null) return null;
  // Reading more pages than the document has is not a display problem, it is a broken report.
  if (pageCount !== null && pagesRead > pageCount) return null;
  const pages = (Array.isArray(body.pages) ? body.pages : []).flatMap((page) => {
    const qualified = qualifyPage(page);
    return qualified ? [qualified] : [];
  });
  return {
    documentId: expected.documentId,
    versionKey: expected.versionKey.toLowerCase(),
    sourceImmutableKey: expected.sourceImmutableKey,
    sourceSha256: expected.sourceSha256,
    state: body.state,
    pagesRead,
    pageCount,
    regionsFound,
    pages,
  };
}

/** A response may commit only while both its selection and authority generation are still current. */
export function isCurrentSourceObservation(
  response: Pick<OcrProgress, "documentId" | "versionKey">,
  selected: { documentId: string; versionKey: string } | null,
  responseAuthority: number,
  currentAuthority: number,
  responseSequence = 0,
  currentSequence = 0,
): boolean {
  return responseAuthority === currentAuthority
    && responseSequence === currentSequence
    && selected?.documentId === response.documentId
    && selected.versionKey.toLowerCase() === response.versionKey.toLowerCase();
}

export type SourceVersionIdentity = { documentId: string; versionKey: string };

/** A temporary read failure only blocks polling the exact immutable version that failed. */
export function markSourceVersionUnavailable(
  unavailable: Map<string, string>,
  source: SourceVersionIdentity,
): void {
  unavailable.set(source.documentId, source.versionKey.toLowerCase());
}

/** A successful issue/read clears only its own version's temporary unavailable marker. */
export function clearSourceVersionUnavailable(
  unavailable: Map<string, string>,
  source: SourceVersionIdentity,
): void {
  if (unavailable.get(source.documentId) === source.versionKey.toLowerCase()) {
    unavailable.delete(source.documentId);
  }
}

/** Drop markers when inventory moves to another immutable version or removes the source. */
export function pruneUnavailableSourceVersions(
  unavailable: Map<string, string>,
  currentSources: readonly SourceVersionIdentity[],
): void {
  const currentVersions = new Map(currentSources.map((source) => [source.documentId, source.versionKey.toLowerCase()]));
  for (const [documentId, failedVersion] of unavailable) {
    if (currentVersions.get(documentId) !== failedVersion) unavailable.delete(documentId);
  }
}

/** Filter the current inventory, pruning an obsolete marker when the source version advances. */
export function filterPollableSourceVersions<T extends SourceVersionIdentity>(
  sources: readonly T[],
  unavailable: Map<string, string>,
): T[] {
  return sources.filter((source) => {
    const failedVersion = unavailable.get(source.documentId);
    if (!failedVersion) return true;
    if (failedVersion === source.versionKey.toLowerCase()) return false;
    unavailable.delete(source.documentId);
    return true;
  });
}

/** The page to draw: the latest one reported. Null when nothing has been read yet. */
export function currentPage(progress: OcrProgress): ProgressPage | null {
  return progress.pages.length > 0 ? progress.pages[progress.pages.length - 1] : null;
}

/**
 * How far through the document the read is, as a fraction.
 *
 * Returns null rather than a guess when the page count is unknown. A bar that fills without
 * knowing what it is filling toward is the exact thing this product does not do.
 */
export function readFraction(progress: OcrProgress): number | null {
  if (progress.pageCount === null || progress.pageCount <= 0) return null;
  return Math.min(1, progress.pagesRead / progress.pageCount);
}
