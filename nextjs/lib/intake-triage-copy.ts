/** Display translations only. API values and qualification decisions stay unchanged. */
export function intakeDisplayToken(token: string): string {
  switch (token) {
    case "BEST_EFFORT": return "Supported with limitations";
    case "bbox1000": return "Locations on the source page";
    case "entire_affected_source_version_set": return "All affected files and versions";
    default: return token.replaceAll("_", " ");
  }
}

/** Call only for the named operation result, never from an absent receipt or approval ID. */
export function triageUploadNotice(
  phase: "inventory_staged" | "sealed_review" | "receipt_ready" | "upload_interrupted",
  errorCode?: string,
): string {
  switch (phase) {
    case "inventory_staged":
      return "Source inventory staged. This inventory step does not upload file bytes. Review the separate bounded upload-check approval below; full processing requires a later approval.";
    case "sealed_review":
      return "Files uploaded and sealed for checks. Full processing has not started. Choose include or exclude for every row; identical bytes remain separate reviewable sources.";
    case "receipt_ready":
      return "Files uploaded and sealed. The receipt is ready for a separate full-processing quote and approval. Full processing has not started.";
    case "upload_interrupted":
      return `Upload checks did not complete${errorCode ? ` (${errorCode})` : ""}. Some file bytes may already have been uploaded. No parsing or full-processing approval was requested; processing remains blocked.`;
  }
}
