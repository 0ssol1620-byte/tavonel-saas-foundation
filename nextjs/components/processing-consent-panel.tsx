"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useDialogFocus } from "./world-visual/use-dialog-focus";
import styles from "./processing-consent-panel.module.css";

/*
  The owner's explicit agreement to the published Self-Service Terms and Processing Addendum,
  for direct upload only. Recording it is evidence, not access: the workspace's file intake stays
  closed until the separate qualified grant opens it, so this panel never says uploads are ready.
  The offer is fetched only when the owner asks to review it, and the POST names that exact
  version and both document hashes -- if the published text changed meanwhile the server refuses
  with PROCESSING_TERMS_OFFER_CHANGED and the owner reviews the new text instead.
*/

type TermsDocument = { path: string; sha256: string };
export type ProcessingTermsOffer = { version: string; terms: TermsDocument; processing: TermsDocument };
export type ProcessingTermsReceipt = { acceptanceId: string; acceptedAt: string; idempotentReplay: boolean };
/** `status` 0 means no HTTP answer was received. */
type Failure = { ok: false; code: string; status: number };

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseDocument(value: unknown): TermsDocument | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string") return null;
  if (!value.path.startsWith("/policy/") || !SHA256.test(value.sha256)) return null;
  return { path: value.path, sha256: value.sha256 };
}

/** Only an offer that names both documents and allows the direct_upload scope can be accepted here. */
export function parseProcessingTermsOffer(value: unknown): ProcessingTermsOffer | null {
  if (!isRecord(value) || typeof value.version !== "string" || !value.version) return null;
  if (!Array.isArray(value.scopes) || !value.scopes.includes("direct_upload")) return null;
  const terms = parseDocument(value.terms);
  const processing = parseDocument(value.processing);
  return terms && processing ? { version: value.version, terms, processing } : null;
}

const codeOf = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => null) as { code?: unknown } | null;
  return typeof body?.code === "string" ? body.code : fallback;
};

export async function fetchProcessingTerms(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<{ ok: true; offer: ProcessingTermsOffer } | Failure> {
  try {
    const response = await fetchImpl("/api/access/processing-terms", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return { ok: false, code: await codeOf(response, "PROCESSING_TERMS_UNAVAILABLE"), status: response.status };
    const offer = parseProcessingTermsOffer(await response.json().catch(() => null));
    return offer ? { ok: true, offer } : { ok: false, code: "PROCESSING_TERMS_UNAVAILABLE", status: response.status };
  } catch {
    return { ok: false, code: "NETWORK_ERROR", status: 0 };
  }
}

/** Exactly the keys the route accepts; the workspace and user come from the session, never the body. */
export const acceptanceBody = (offer: ProcessingTermsOffer) => ({
  accepted: true as const,
  version: offer.version,
  terms: { path: offer.terms.path, sha256: offer.terms.sha256 },
  processing: { path: offer.processing.path, sha256: offer.processing.sha256 },
  scope: "direct_upload" as const,
});

type AcceptResult = { ok: true; receipt: ProcessingTermsReceipt } | Failure;

/** One recording at a time: a second click while the first is in flight joins it instead of posting again. */
export function createTermsAcceptor(fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {
  let pending: Promise<AcceptResult> | null = null;
  const run = async (offer: ProcessingTermsOffer, getToken: () => Promise<string | null>): Promise<AcceptResult> => {
    try {
      const token = await getToken();
      // Never sent, so nothing can have been recorded.
      if (!token) return { ok: false, code: "AUTH_REQUIRED", status: 401 };
      const response = await fetchImpl("/api/access/processing-terms", {
        method: "POST",
        credentials: "same-origin",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(acceptanceBody(offer)),
      });
      if (!response.ok) return { ok: false, code: await codeOf(response, "PROCESSING_TERMS_STORE_FAILED"), status: response.status };
      const body = await response.json().catch(() => null) as { code?: unknown; receipt?: Record<string, unknown> } | null;
      const receipt = body?.receipt;
      if (body?.code !== "PROCESSING_TERMS_ACCEPTED" || !receipt || receipt.scope !== "direct_upload"
        || typeof receipt.acceptanceId !== "string" || typeof receipt.acceptedAt !== "string") {
        return { ok: false, code: "PROCESSING_TERMS_STORE_INVALID", status: response.status };
      }
      return {
        ok: true,
        receipt: { acceptanceId: receipt.acceptanceId, acceptedAt: receipt.acceptedAt, idempotentReplay: receipt.idempotentReplay === true },
      };
    } catch {
      return { ok: false, code: "NETWORK_ERROR", status: 0 };
    }
  };
  return (offer: ProcessingTermsOffer, getToken: () => Promise<string | null>) =>
    pending ??= run(offer, getToken).finally(() => { pending = null; });
}

export function termsLoadErrorSentence(failure: Failure) {
  return failure.status === 0
    ? "The published terms could not be loaded. Check your connection and try again."
    : "The published terms are unavailable right now. Try again shortly.";
}

/*
  "Nothing was recorded" only where the server refused the request before recording, i.e. an
  explicit 4xx. A dropped connection, a 5xx or an unreadable reply may follow a committed write,
  so those say the outcome is unconfirmed -- and retrying is safe because the route replays an
  existing acceptance of the same terms instead of recording a second one.
*/
export function termsSubmitErrorSentence(failure: Failure) {
  if (failure.status < 400 || failure.status >= 500) {
    return "We could not confirm that your agreement was recorded. You can safely try again. Accepting the same terms again does not record them twice.";
  }
  switch (failure.code) {
    case "AUTH_REQUIRED": return "Your session has ended. Sign in again, then accept the terms. Nothing was recorded.";
    case "WORKSPACE_OWNER_REQUIRED": return "Only the owner of this workspace can accept these terms. Nothing was recorded.";
    case "PROCESSING_TERMS_OFFER_CHANGED": return "The published terms changed while you were reading. Nothing was recorded. Load the current version and review it again.";
    default: return "Your agreement was not accepted and nothing was recorded. Reload the page and try again.";
  }
}

type FormProps = {
  offer: ProcessingTermsOffer;
  agreed: boolean;
  submitting: boolean;
  error: string | null;
  onAgreedChange: (agreed: boolean) => void;
  onSubmit: () => void;
};

export function ProcessingTermsForm({ offer, agreed, submitting, error, onAgreedChange, onSubmit }: FormProps) {
  const errorId = useId();
  return (
    <form
      className={styles.form}
      aria-busy={submitting}
      onSubmit={(event: FormEvent) => { event.preventDefault(); if (agreed && !submitting) onSubmit(); }}
    >
      {/*
        FUNNEL-SIGNED-IN #6: three plain lines over the documents, each said in the addendum this links
        to. They summarise and do not replace it, so the checkbox below still names both documents.
      */}
      <ul className={styles.summary} aria-label="The terms in brief">
        <li>We process the files you upload to read them and build your World.</li>
        <li>Your files are not used to train shared models.</li>
        <li>You can export your results and ask us to delete your files.</li>
      </ul>
      <p>
        Read the <a href={offer.terms.path} target="_blank" rel="noopener noreferrer">Self-Service Terms</a> and
        the <a href={offer.processing.path} target="_blank" rel="noopener noreferrer">Processing Addendum</a> (version {offer.version}).
        Accepting records your agreement for files you upload to this workspace. File processing opens separately.
      </p>
      <label className={styles.agree}>
        <input
          type="checkbox"
          checked={agreed}
          disabled={submitting}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onAgreedChange(event.target.checked)}
        />
        <span>I have read and agree to the Self-Service Terms and the Processing Addendum.</span>
      </label>
      {error ? <p id={errorId} className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button type="submit" className="btn" disabled={!agreed || submitting}>
          {submitting ? "Recording agreement…" : "Accept terms"}
        </button>
      </div>
    </form>
  );
}

type Stage = "closed" | "loading" | "load_failed" | "review" | "submitting" | "accepted";

/*
  The review-and-accept sequence, once. The workspace panel and the /pricing dialog (one-step buy,
  2026-11-10) both run it, so the offer they show, the version they post and the sentences they
  answer with cannot drift apart. `onAccepted` runs only after the server answered with a receipt.
*/
function useProcessingTerms(getToken: () => Promise<string | null>, onAccepted: () => void | Promise<void>) {
  const [stage, setStage] = useState<Stage>("closed");
  const [offer, setOffer] = useState<ProcessingTermsOffer | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ProcessingTermsReceipt | null>(null);
  const [accept] = useState(() => createTermsAcceptor());

  const load = async () => {
    setStage("loading");
    setError(null);
    const result = await fetchProcessingTerms();
    if (result.ok) { setOffer(result.offer); setAgreed(false); setStage("review"); return; }
    setError(termsLoadErrorSentence(result));
    setStage("load_failed");
  };

  const submit = async () => {
    if (!offer || !agreed) return;
    setStage("submitting");
    setError(null);
    const result = await accept(offer, getToken);
    if (result.ok) {
      setReceipt(result.receipt);
      setStage("accepted");
      await Promise.resolve(onAccepted()).catch(() => undefined);
      return;
    }
    if (result.code === "PROCESSING_TERMS_OFFER_CHANGED") {
      // Never carry a tick over to text the owner has not seen.
      setOffer(null);
      setAgreed(false);
      setError(termsSubmitErrorSentence(result));
      setStage("load_failed");
      return;
    }
    setError(termsSubmitErrorSentence(result));
    setStage("review");
  };

  return { stage, setStage, offer, agreed, setAgreed, error, receipt, load, submit };
}

/** Loading, a load failure, or the form: every stage before a receipt. */
function TermsSteps({ flow }: { flow: ReturnType<typeof useProcessingTerms> }) {
  const { stage, offer, agreed, error } = flow;
  return (
    <>
      {stage === "loading" ? <p role="status">Loading the published terms…</p> : null}
      {stage === "load_failed" ? (
        <>
          <p className={styles.error} role="alert">{error}</p>
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={() => void flow.load()}>Load the terms again</button>
          </div>
        </>
      ) : null}
      {(stage === "review" || stage === "submitting") && offer ? (
        <ProcessingTermsForm
          offer={offer}
          agreed={agreed}
          submitting={stage === "submitting"}
          error={error}
          onAgreedChange={flow.setAgreed}
          onSubmit={() => void flow.submit()}
        />
      ) : null}
    </>
  );
}

type Props = {
  getToken: () => Promise<string | null>;
  /** Re-reads workspace access; the grant, not this receipt, decides whether intake opens. */
  onAccepted: () => void | Promise<void>;
  /** The other actions in the row, e.g. the public example link. */
  children?: ReactNode;
};

export default function ProcessingConsentPanel({ getToken, onAccepted, children }: Props) {
  const regionId = useId();
  const flow = useProcessingTerms(getToken, onAccepted);
  const { stage, setStage, offer, receipt } = flow;

  const toggle = () => {
    if (stage === "closed") { if (receipt) setStage("accepted"); else if (offer) setStage("review"); else void flow.load(); }
    else if (stage !== "submitting") setStage("closed");
  };

  const open = stage !== "closed";
  return (
    <>
      <div className="workspace-intake-gated-actions">
        <button type="button" className="btn" aria-expanded={open} aria-controls={regionId} onClick={toggle}>
          Review processing terms
        </button>
        {children}
      </div>
      <section id={regionId} className={styles.panel} hidden={!open} aria-label="Processing terms">
        <TermsSteps flow={flow} />
        {stage === "accepted" && receipt ? (
          <div role="status">
            <p>
              <strong>Terms accepted.</strong> Recorded {new Date(receipt.acceptedAt).toLocaleString()}.
            </p>
            <p>File processing is not active for this workspace yet. The file drop opens here once it is.</p>
            <div className={styles.actions}>
              <button type="button" className="btn ghost" onClick={() => void Promise.resolve(onAccepted()).catch(() => undefined)}>
                Check file access again
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

/*
  One-step buy (2026-11-10). The same terms step, in a modal dialog over /pricing, for a buyer whose
  checkout was refused because the terms are still owed. Same offer read, same POST, same consent
  record and the same words as the workspace panel. Only the frame differs.

  A native modal `<dialog>`: the page behind it is inert, Escape closes it (the `cancel` event, held
  while an agreement is being recorded), and `useDialogFocus` keeps Tab inside and hands focus back
  to the Buy control on close. The terms load as it opens. `onAccepted` runs once a receipt is back,
  and the caller closes the dialog there.
*/
export function ProcessingTermsDialog({
  title,
  lead,
  getToken,
  onAccepted,
  onClose,
}: {
  title: string;
  lead: string;
  getToken: () => Promise<string | null>;
  onAccepted: () => void | Promise<void>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  const flow = useProcessingTerms(getToken, onAccepted);
  const busy = flow.stage === "submitting";
  // Declared before the effect that opens the dialog, so it records the Buy control as the opener.
  useDialogFocus(dialogRef);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    headingRef.current?.focus();
    void flow.load();
    // Opens once per mount. The caller unmounts the dialog to close it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    >
      <div className={styles.dialogHead}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Close</button>
      </div>
      <p className={styles.lead}>{lead}</p>
      <TermsSteps flow={flow} />
    </dialog>
  );
}
