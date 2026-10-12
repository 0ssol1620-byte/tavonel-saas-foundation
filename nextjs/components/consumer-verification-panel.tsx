"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  abstentionSentence,
  createVerificationController,
  describeVerificationState,
  retrievalPathLabel,
  type VerificationController,
  type VerificationReceipt,
  type VerificationState,
} from "@/lib/consumer-verification";

function ReceiptView({ receipt }: { receipt: VerificationReceipt }) {
  return (
    <div className="api-key-list">
      <article>
        <div>
          <strong>Retrieval path</strong>
          <small>{retrievalPathLabel(receipt.retrievalPath)}</small>
          <small>Answer mode: evidence excerpts. The answer is the cited text itself; no model wrote it.</small>
        </div>
      </article>
      {receipt.outcome === "evidence" ? (
        <article>
          <div>
            <strong>Returned answer</strong>
            {receipt.answer.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
        </article>
      ) : (
        <article>
          <div>
            <strong>No answer returned</strong>
            <small>{abstentionSentence(receipt.abstentionReason)}</small>
          </div>
        </article>
      )}
      <article>
        <div>
          <strong>Snapshot that answered</strong>
          <small>World {receipt.activeWorld.worldStateId} · revision {receipt.activeWorld.revision}</small>
          <small>Manifest {receipt.activeWorld.manifestDigest}</small>
        </div>
      </article>
      <article>
        <div>
          <strong>Receipt</strong>
          <small>Collection {receipt.receipt.collectionId}</small>
          <small>Output {receipt.receipt.outputSha256}</small>
        </div>
      </article>
      {receipt.citations.map((citation, index) => (
        <article key={index}>
          <div>
            <strong>Evidence {citation.evidenceId}</strong>
            <small>
              {citation.sourceId ? `Source ${citation.sourceId} · ` : ""}
              {citation.unitId ? `Unit ${citation.unitId} · ` : ""}
              Version {citation.sourceVersionId}
              {citation.pageNumber1 !== null ? ` · page ${citation.pageNumber1}` : ""}
              {citation.bbox1000 !== null ? ` · region ${citation.bbox1000.join(", ")}` : ""}
            </small>
            <small>{citation.excerpt}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function ConsumerVerificationPanel() {
  const [apiKey, setApiKey] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<VerificationState>({ kind: "idle" });
  const controllerRef = useRef<VerificationController | null>(null);

  useEffect(() => {
    const controller = createVerificationController({
      fetch: (url, init) => fetch(url, init),
      onState: (next) => {
        setState(next);
        // The entered key is held only until its one request has an outcome.
        if (next.kind === "evidence" || next.kind === "abstained" || next.kind === "refused") setApiKey("");
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  // Any edit abandons a request in flight and clears the previous result before it can be misread.
  const edit = (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    setter(event.target.value);
    controllerRef.current?.invalidate();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void controllerRef.current?.submit({ apiKey, collectionId, question });
  };

  const pending = state.kind === "pending";

  return (
    <section className="developer-readout" aria-labelledby="consumer-verification-title">
      <header className="studio-heading">
        <div>
          <p className="eyebrow">Verify an issued key</p>
          <h3 id="consumer-verification-title">Ask one question through the API.</h3>
        </div>
      </header>
      <p className="world-empty">
        This sends exactly one POST to /api/v1/collections/&#123;id&#125;/ask with the key you enter, and counts as one Ask
        request against that key&apos;s ask:read allowance. It checks the HTTP API only: it does not test the MCP bridge or the
        CLI, and it does not judge whether the answer is correct. The key is kept in this page only until the request has an
        outcome, and is never stored.
      </p>
      <form className="api-key-form" onSubmit={submit} autoComplete="off">
        <label htmlFor="consumer-verify-key">Issued API key (needs ask:read)</label>
        <input id="consumer-verify-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={edit(setApiKey)} />
        <label htmlFor="consumer-verify-collection">Collection ID</label>
        <input id="consumer-verify-collection" autoComplete="off" spellCheck={false} placeholder="collection-..." value={collectionId} onChange={edit(setCollectionId)} />
        <label htmlFor="consumer-verify-question">Question</label>
        <input id="consumer-verify-question" autoComplete="off" maxLength={500} value={question} onChange={edit(setQuestion)} />
        <button type="submit" disabled={pending}>{pending ? "Waiting for the API..." : "Send one Ask request"}</button>
        {pending ? <button type="button" onClick={() => controllerRef.current?.cancel()}>Cancel request</button> : null}
      </form>
      <p className="connection-notice" role="status" aria-live="polite">
        {describeVerificationState(state)}
        {state.kind === "refused" && state.refusal.serverCode ? ` (API code ${state.refusal.serverCode}.)` : ""}
        {state.kind === "refused" && state.refusal.status !== null ? ` HTTP ${state.refusal.status}.` : ""}
      </p>
      {state.kind === "evidence" || state.kind === "abstained" ? <ReceiptView receipt={state.receipt} /> : null}
    </section>
  );
}
