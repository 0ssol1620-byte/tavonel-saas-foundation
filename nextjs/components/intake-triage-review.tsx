"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { intakeDisplayToken, triageUploadNotice } from "@/lib/intake-triage-copy";
import {
  approveAndSealTriage,
  confirmLegacyFallback,
  createLegacyFallbackGate,
  finalizeTriageReceipt,
  quoteTriageProcessing,
  stageTriage,
  type StageTriageResult,
  type TriageReceiptReply,
  type TriageProcessingQuote,
  type TriageReviewRow,
  type TriageUploadFile,
} from "@/lib/intake-triage-client";

type Props = {
  files: TriageUploadFile[];
  getToken: () => Promise<string | null>;
  onLegacyFallback: () => void;
  initialEstimate: { minimumUsd: number; maximumUsd: number } | null;
  selectionRevision: string;
  disabled?: boolean;
  onProcessingApproval: (quote: TriageProcessingQuote) => Promise<"completed" | "stale" | "uncertain" | "blocked" | void> | "completed" | "stale" | "uncertain" | "blocked" | void;
};

function resetForFreshReceipt(setters: {
  setBatch: (value: Extract<StageTriageResult, { kind: "ready" }> | null) => void;
  setApprovalId: (value: string | null) => void;
  setReview: (value: TriageReviewRow[]) => void;
  setChoices: (value: Record<string, "include" | "exclude">) => void;
  setReceipt: (value: TriageReceiptReply | null) => void;
  setProcessingQuote: (value: TriageProcessingQuote | null) => void;
  setProcessingConsent: (value: boolean) => void;
}) {
  setters.setBatch(null);
  setters.setApprovalId(null);
  setters.setReview([]);
  setters.setChoices({});
  setters.setReceipt(null);
  setters.setProcessingQuote(null);
  setters.setProcessingConsent(false);
}

function money(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "Not priced";
}

function rowValue(row: TriageReviewRow, key: string): string {
  const value = (row.unknowns && key in row.unknowns ? row.unknowns[key] : row[key]);
  return typeof value === "string" ? value.replaceAll("_", " ") : "unknown";
}

export function TriageReviewList({
  review, choices, onChoice, disabled = false,
}: {
  review: TriageReviewRow[];
  choices: Record<string, "include" | "exclude">;
  onChoice: (fileKey: string, choice: "include" | "exclude") => void;
  disabled?: boolean;
}) {
  return (
    <ul className="workspace-preflight-files" aria-label="Server classified source inventory">
      {review.map((row, index) => (
        <li key={`${row.fileKey}:${index}`} data-status={row.disposition ?? "needs_review"}>
          <strong>{row.relativePath}</strong>
          <span>Signature: {rowValue(row, "signature")}; encryption: {rowValue(row, "encryption")}; corruption: {rowValue(row, "corruption")}; archive expansion: {rowValue(row, "archiveExpansion")}</span>
          <span>{row.disposition?.replaceAll("_", " ") ?? "needs review"}: {row.reason?.replaceAll("_", " ") ?? "server inventory result"}.</span>
          {row.exactDuplicateOf ? <span>Exact byte duplicate candidate of another source. This source stays separate for review.</span> : null}
          <label>
            Include in quoted set
            <select aria-label={`Review ${row.relativePath}`} value={choices[row.fileKey] ?? ""} disabled={disabled} onChange={(event) => onChoice(row.fileKey, event.target.value as "include" | "exclude")}>
              <option value="">Choose…</option>
              <option value="include">Include</option>
              <option value="exclude">Exclude</option>
            </select>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function TriageCostStatus({ estimate, approvalBlockers }: {
  estimate: TriageReceiptReply["estimate"];
  approvalBlockers: string[];
}) {
  const sourceVersions = estimate.customerChargeCoverage.sourceVersions;
  const recompileRequested = sourceVersions.some((source) => source.mode === "unchanged_already_read_recompile");
  const readProofRequired = approvalBlockers.includes("READ_PROOF_REQUIRED") || recompileRequested;
  return (
    <div aria-label="Cost status">
      <p>Initial customer page charge for this complete source/version set: {money(estimate.initial.minimum)}–{money(estimate.initial.maximum)}.</p>
      {readProofRequired ? (
        <p className="fine workspace-preflight-blocked" role="alert">
          <strong>Recompile quote and approval unavailable.</strong> The server has no trusted persisted proof that these unchanged source versions were already read and metered. No incremental charge is quoted for this request.
        </p>
      ) : recompileRequested ? (
        <p>For verified unchanged, already-read sources only, the published policy adds {money(estimate.incremental.minimum)}–{money(estimate.incremental.maximum)} in page charges.</p>
      ) : (
        <p>This request is a new read; its page charge is shown in the initial estimate. No recompile quote is being made.</p>
      )}
      <p>Quote scope: {intakeDisplayToken(estimate.customerChargeCoverage.scope)}; pricing policy: published per-page admission, once per document.</p>
      <p className="fine">Operator infrastructure cost: {estimate.operatorCost.status === "priced" ? "priced separately" : "not priced; separate from this customer charge"}.</p>
      {estimate.operatorCost.unavailableProviders.map((provider) => <p className="fine" key={provider}>Operator cost unavailable: {provider.replaceAll("_", " ")}.</p>)}
      {approvalBlockers.filter((blocker) => blocker !== "READ_PROOF_REQUIRED").map((blocker) => <p className="fine workspace-preflight-blocked" role="alert" key={blocker}>{blocker.replaceAll("_", " ")}</p>)}
      <p className="fine">No parsing, compute reservation, or full-processing approval has been started.</p>
    </div>
  );
}
export default function IntakeTriageReview({ files, getToken, onLegacyFallback, onProcessingApproval, initialEstimate, selectionRevision, disabled = false }: Props) {
  const [batch, setBatch] = useState<Extract<StageTriageResult, { kind: "ready" }> | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [review, setReview] = useState<TriageReviewRow[]>([]);
  const [choices, setChoices] = useState<Record<string, "include" | "exclude">>({});
  const [receipt, setReceipt] = useState<TriageReceiptReply | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [legacyFallbackPending, setLegacyFallbackPending] = useState(false);
  const [processingQuote, setProcessingQuote] = useState<TriageProcessingQuote | null>(null);
  const [processingConsent, setProcessingConsent] = useState(false);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const revisionRef = useRef(selectionRevision);
  const controllerRef = useRef<AbortController | null>(null);
  const fallbackGateRef = useRef(createLegacyFallbackGate());

  const resetForFreshReceiptState = () => resetForFreshReceipt({
    setBatch, setApprovalId, setReview, setChoices, setReceipt, setProcessingQuote, setProcessingConsent,
  });

  useLayoutEffect(() => {
    revisionRef.current = selectionRevision;
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    busyRef.current = false;
    mountedRef.current = true;
    fallbackGateRef.current = createLegacyFallbackGate();
    setBatch(null);
    setApprovalId(null);
    setReview([]);
    setChoices({});
    setReceipt(null);
    setNotice("");
    setBusy(false);
    setLegacyFallbackPending(false);
    setProcessingQuote(null);
    setProcessingConsent(false);
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      busyRef.current = false;
    };
  }, [selectionRevision]);

  const beginOperation = () => {
    if (!mountedRef.current || busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const id = ++operationRef.current;
    return { id, revision: selectionRevision, controller };
  };

  const operationIsCurrent = (operation: NonNullable<ReturnType<typeof beginOperation>>) =>
    mountedRef.current && operationRef.current === operation.id
      && revisionRef.current === operation.revision && !operation.controller.signal.aborted;

  const endOperation = (operation: NonNullable<ReturnType<typeof beginOperation>>) => {
    if (!operationIsCurrent(operation)) return;
    busyRef.current = false;
    controllerRef.current = null;
    setBusy(false);
  };

  const stage = async () => {
    const operation = beginOperation();
    if (!operation) return;
    setNotice("Checking the server triage route. This availability check does not upload file bytes.");
    try {
      const token = await getToken();
      if (!operationIsCurrent(operation)) return;
      if (!token) { setNotice("Sign in again before starting source triage."); return; }
      const result = await stageTriage(files, token, fetch, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if (result.kind === "disabled") {
        fallbackGateRef.current.markDisabled();
        setLegacyFallbackPending(true);
        setNotice("Server triage is disabled. This availability check does not upload file bytes. Review the full-scope maximum below.");
        return;
      }
      if (result.kind === "blocked") { setNotice(`Triage is blocked (${result.error.code}). No legacy fallback was used.`); return; }
      setBatch(result);
      setNotice(triageUploadNotice("inventory_staged"));
    } catch {
      if (operationIsCurrent(operation)) setNotice("Triage could not be reached. No legacy fallback was used.");
    } finally {
      endOperation(operation);
    }
  };

  const approveLegacyFallback = () => {
    confirmLegacyFallback(fallbackGateRef.current, legacyFallbackPending, busyRef.current, () => {
      busyRef.current = true;
      setBusy(true);
      onLegacyFallback();
    });
  };

  const consentPreflight = async () => {
    if (!batch) return;
    const operation = beginOperation();
    if (!operation) return;
    setNotice("Applying the bounded preflight approval and checking each staged source.");
    try {
      const token = await getToken();
      if (!operationIsCurrent(operation)) return;
      if (!token) { setNotice("Sign in again before approving bounded preflight."); return; }
      const result = await approveAndSealTriage(batch, files, token, fetch, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if ("error" in result) { setNotice(triageUploadNotice("upload_interrupted", result.error.code)); return; }
      setApprovalId(result.approvalId);
      setReview(result.review);
      setChoices({});
      setNotice(triageUploadNotice("sealed_review"));
    } catch {
      if (operationIsCurrent(operation)) setNotice(triageUploadNotice("upload_interrupted"));
    } finally {
      endOperation(operation);
    }
  };

  const finalize = async () => {
    if (!batch || !approvalId || review.some((row) => !choices[row.fileKey])) return;
    const operation = beginOperation();
    if (!operation) return;
    setNotice("Binding your source choices to the server inventory and current estimate.");
    try {
      const token = await getToken();
      if (!operationIsCurrent(operation)) return;
      if (!token) { setNotice("Sign in again before saving source review."); return; }
      const result = await finalizeTriageReceipt(batch, approvalId, choices, token, fetch, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if ("error" in result) { setNotice(`Review could not be finalized (${result.error.code}). Processing remains blocked.`); return; }
      setReceipt(result);
      setProcessingQuote(null);
      setProcessingConsent(false);
      setNotice(result.code === "TRIAGE_RECEIPT_READY"
        ? triageUploadNotice("receipt_ready") :
          "Files uploaded and sealed. The server requires more qualification or pricing. Full processing approval is unavailable.");
    } catch {
      if (operationIsCurrent(operation)) setNotice("Source review could not be finalized. Processing remains blocked.");
    } finally {
      endOperation(operation);
    }
  };

  const fetchProcessingQuote = async () => {
    if (!receipt || receipt.code !== "TRIAGE_RECEIPT_READY" || !receipt.receipt.approvalReady
      || (receipt.approvalBlockers?.length ?? 0) > 0) return;
    const operation = beginOperation();
    if (!operation) return;
    setProcessingQuote(null);
    setProcessingConsent(false);
    setNotice("Rechecking the complete server-qualified source set and current published price. No approval or processing has started.");
    try {
      const token = await getToken();
      if (!operationIsCurrent(operation)) return;
      if (!token) { setNotice("Sign in again before requesting a full-processing quote."); return; }
      const result = await quoteTriageProcessing(receipt, token, fetch, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if ("error" in result) {
        if (["INTAKE_PRICE_STALE", "INTAKE_RETRIAGE_REQUIRED", "INTAKE_TRIAGE_RECEIPT_STALE"].includes(result.error.code)) {
          resetForFreshReceiptState();
          setNotice("The receipt or published price is stale. Review sources again to obtain a fresh receipt and quote; no approval was submitted.");
        } else {
          setNotice(`A complete current quote is unavailable (${result.error.code}). No processing approval was requested.`);
        }
        return;
      }
      setProcessingQuote(result);
      setNotice("The server returned the current whole-set full-processing maximum. Review it and explicitly approve before processing.");
    } catch {
      if (operationIsCurrent(operation)) setNotice("The full-processing quote could not be confirmed. No processing approval was requested.");
    } finally {
      endOperation(operation);
    }
  };

  const approveProcessing = async () => {
    if (!processingQuote || !processingConsent || !receipt || receipt.code !== "TRIAGE_RECEIPT_READY"
      || !receipt.receipt.approvalReady || (receipt.approvalBlockers?.length ?? 0) > 0) return;
    const operation = beginOperation();
    if (!operation) return;
    setNotice(`Submitting explicit approval for the quoted maximum of ${money(processingQuote.quote.maximumUsd)}. The server will recheck price and receipt before any reservation.`);
    try {
      const result = await onProcessingApproval(processingQuote);
      if (result === "stale") {
        resetForFreshReceiptState();
        setNotice("The quote or receipt expired and the server confirmed no approval was created. Review sources again for a fresh receipt and quote.");
      } else if (result === "uncertain") {
        setNotice("Approval status is unavailable. This receipt and quoted maximum are preserved. Check status or retry this same approval after service recovers.");
      } else if (result === "blocked") {
        setProcessingConsent(false);
        setNotice("Processing approval was blocked. Review the current saved attempt before trying again.");
      }
    } catch {
      if (operationIsCurrent(operation)) {
        setProcessingConsent(false);
        setNotice("Approval could not be confirmed. The saved attempt is preserved; check its status before trying again.");
      }
    } finally {
      endOperation(operation);
    }
  };

  const allChosen = review.length > 0 && review.every((row) => choices[row.fileKey] === "include" || choices[row.fileKey] === "exclude");

  return (
    <section className="workspace-preflight" aria-label="Server source triage">
      <h3>Source inventory and cost review</h3>
      <p className="fine">Before any OCR or parsing, the server checks file identity and keeps every selected path visible. Exact byte matches are review candidates only; they are not silently merged or reused.</p>
      <p className="fine"><strong>Customer page charge:</strong> new reads use the existing published page-price quote. The published policy permits zero additional page charges for a recompile only when unchanged source versions are verified as already read. Without trusted persisted read proof, the recompile quote and approval are unavailable. This does not promise a free reread or new version.</p>
      <p className="fine"><strong>Operator infrastructure cost:</strong> may be unpriced and is separate from the customer page charge. That uncertainty does not invalidate a complete customer quote. Source safety and qualification requirements still block processing when unresolved.</p>
      {!batch && !legacyFallbackPending ? (
        <button type="button" disabled={disabled || busy || files.length === 0} onClick={() => void stage()}>
          {busy ? "Checking triage availability…" : "Review sources before processing"}
        </button>
      ) : null}
      {legacyFallbackPending ? (
        <div role="alert">
          <p><strong>Full-scope legacy approval</strong></p>
          <p>This older path uploads and starts full processing for all {files.length} staged files. It includes unknown-page files and approves the displayed maximum of {initialEstimate ? money(initialEstimate.maximumUsd) : "the current quoted maximum"}. The triage availability check does not upload file bytes.</p>
          <button type="button" disabled={disabled || busy} onClick={approveLegacyFallback}>Approve maximum &amp; upload</button>
        </div>
      ) : null}
      {batch && !approvalId ? (
        <div>
          <p><strong>Bounded preflight consent</strong></p>
          <p>Preliminary initial customer page-charge estimate from the existing intake quote: {initialEstimate ? `${money(initialEstimate.minimumUsd)}–${money(initialEstimate.maximumUsd)}` : "Not available"}. The server recomputes the amount for the complete selected source/version set after inventory review.</p>
          <p className="fine">This authorizes only {batch.staged.length} files and {batch.staged.reduce((sum, row) => sum + row.requestedBytes, 0).toLocaleString()} declared bytes for server-side signature and inventory checks. Operator infrastructure cost is not priced. No OCR, LLM, compute reservation, or compile is authorized. Encryption, corruption, and archive expansion may remain unknown.</p>
          <button type="button" disabled={busy} onClick={() => void consentPreflight()}>{busy ? "Checking sources…" : "Approve bounded source preflight"}</button>
        </div>
      ) : null}
      {review.length > 0 ? (
        <>
          <TriageReviewList
            review={review}
            choices={choices}
            disabled={busy || !!receipt}
            onChoice={(fileKey, choice) => setChoices((previous) => ({ ...previous, [fileKey]: choice }))}
          />
          {!receipt ? <button type="button" disabled={busy || !allChosen} onClick={() => void finalize()}>Save choices and show estimate</button> : null}
        </>
      ) : null}
      {receipt ? <TriageCostStatus estimate={receipt.estimate} approvalBlockers={receipt.approvalBlockers ?? []} /> : null}
      {receipt && (receipt.code !== "TRIAGE_RECEIPT_READY" || !receipt.receipt.approvalReady || (receipt.approvalBlockers?.length ?? 0) > 0) ? (
        <p className="fine workspace-preflight-blocked" role="status">Server qualification is incomplete. Full-processing quote and approval are unavailable. Review the listed unknowns or blockers; no paid work has started.</p>
      ) : null}
      {receipt?.code === "TRIAGE_RECEIPT_READY" && receipt.receipt.approvalReady && (receipt.approvalBlockers?.length ?? 0) === 0 ? (
        <div aria-label="Full processing approval">
          {!processingQuote ? <button type="button" disabled={busy || disabled} onClick={() => void fetchProcessingQuote()}>
            {busy ? "Checking current quote…" : "Get full-processing quote"}
          </button> : <>
            <p>Current server quote for {processingQuote.files.length} selected source(s): estimated {money(processingQuote.quote.estimatedUsd)}, maximum {money(processingQuote.quote.maximumUsd)}. This covers the complete set at the published page price.</p>
            <label>
              <input type="checkbox" checked={processingConsent} disabled={busy || disabled} onChange={(event) => setProcessingConsent(event.target.checked)} />
              I approve full processing up to {money(processingQuote.quote.maximumUsd)} for this complete selected source set.
            </label>
            <button type="button" disabled={busy || disabled || !processingConsent} onClick={() => void approveProcessing()}>
              {busy ? "Starting approved processing…" : notice.startsWith("Approval status is unavailable") ? "Check saved approval / retry same approval" : "Approve maximum and process sources"}
            </button>
          </>}
          <p className="fine">This separate approval authorizes the existing reservation and processing flow. Reviewing, uploading for preflight, or classifying sources alone never starts paid work.</p>
        </div>
      ) : null}
      <p className="fine" role="status" aria-live="polite">{notice}</p>
    </section>
  );
}
