import { PROCESSING_CEILING, PROCESSING_CEILING_MIB } from "../../shared/intakeCeiling";

/*
  FUNNEL-SIGNED-IN #7: the preflight printed manifest tokens with the underscores taken out --
  "read through cdr sanitized pdf and ocr", "at most 5 mib per source". The ones a customer meets
  on a PDF are said in plain words, with the size in MB as everywhere else on the site. The numbers
  come from shared/intakeCeiling.ts, the same constants that build the tokens.
*/
const PLAIN_TOKENS: Readonly<Record<string, string>> = {
  read_through_cdr_sanitized_pdf_and_ocr: "read from a cleaned copy of the file with text recognition",
  no_native_structure_reader_yet: "headings and sections are not read as structure yet",
  no_visual_native_reconciliation: "text is not yet cross-checked between the page image and the file",
  [`at_most_${PROCESSING_CEILING_MIB}_mib_per_source`]: `up to ${PROCESSING_CEILING_MIB} MB per file`,
  [`at_most_${PROCESSING_CEILING.maxSourcePages}_pages_per_source`]: `up to ${PROCESSING_CEILING.maxSourcePages} pages per file`,
  [`over_the_${PROCESSING_CEILING_MIB}_mib_processing_ceiling`]: `over the ${PROCESSING_CEILING_MIB} MB per-file limit`,
};

/** Display translations only. API values and qualification decisions stay unchanged. */
export function intakeDisplayToken(token: string): string {
  switch (token) {
    case "BEST_EFFORT": return "Supported with limitations";
    case "bbox1000": return "Locations on the source page";
    case "entire_affected_source_version_set": return "All affected files and versions";
    default: return PLAIN_TOKENS[token] ?? token.replaceAll("_", " ");
  }
}

/** Call only for the named operation result, never from an absent receipt or approval ID. */
export function triageUploadNotice(
  phase: "inventory_staged" | "sealed_review" | "receipt_ready" | "upload_interrupted",
  errorCode?: string,
): string {
  switch (phase) {
    case "inventory_staged":
      return "Source inventory staged. This inventory step does not upload file bytes. Review the separate bounded upload-check approval below. Full processing requires a later approval.";
    case "sealed_review":
      return "Files uploaded and sealed for checks. Full processing has not started. Choose include or exclude for every row. Identical bytes remain separate reviewable sources.";
    case "receipt_ready":
      return "Files uploaded and sealed. The receipt is ready for a separate full-processing quote and approval. Full processing has not started.";
    case "upload_interrupted":
      return `Upload checks did not complete${errorCode ? ` (${errorCode})` : ""}. Some file bytes may already have been uploaded. No parsing or full-processing approval was requested. Processing remains blocked.`;
  }
}
