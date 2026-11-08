"use client";

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatTimestamp } from "@/lib/format";
import type { OntologyCandidate, OntologyCandidatesResponse } from "@/lib/ontology-schema";
import { schemaReviewCopy, schemaReviewError, type SchemaReviewCopy } from "@/lib/schema-review-copy";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./schema-review.module.css";

/*
  C1 Schema screen: the proposed types and relations of one World, each with the source passages
  it came from, and a person's certify / reject / edit on each.

  Candidate-only. Nothing on this screen certifies by default, in bulk or on load: every verdict is
  one button on one candidate plus a typed reason. A certified type is stored and shown, and used by
  nothing yet (C2 is the first consumer).

  The deployment flag reaches the browser the way TAVONEL_REMOTE_MCP_ENABLED does (layout.tsx reads
  it on the server and provides it here). Off: the shell has no Schema entry, the page never renders
  this, and the routes it would call answer 404 without writing.

  No animation at all, so reduced motion has nothing to reduce.
*/

const Availability = createContext(false);

export function OntologyInductionAvailability({ enabled, children }: { enabled: boolean; children?: ReactNode }) {
  return <Availability.Provider value={enabled}>{children}</Availability.Provider>;
}

export function useOntologyInductionEnabled(): boolean {
  return useContext(Availability);
}

type Verdict = "certify" | "reject" | "edit";
type Load = { state: "loading" } | { state: "error"; code?: string } | { state: "ready"; data: OntologyCandidatesResponse };

async function authorization(): Promise<string | null> {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ? `Bearer ${data.session.access_token}` : null;
}

export default function SchemaReview({ collection }: { collection: { collectionId: string; manifestDigest: string } | null }) {
  const [copy, setCopy] = useState<SchemaReviewCopy>(() => schemaReviewCopy());
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  const [deriving, setDeriving] = useState(false);

  useEffect(() => { setCopy(schemaReviewCopy(navigator.languages)); }, []);

  const read = useCallback(async () => {
    if (!collection) return;
    const token = await authorization();
    if (!token) { setLoad({ state: "error", code: "AUTH_REQUIRED" }); return; }
    try {
      const response = await fetch(`/api/ontology/candidates?collectionId=${encodeURIComponent(collection.collectionId)}`, {
        headers: { authorization: token }, cache: "no-store",
      });
      const body = await response.json().catch(() => null) as (OntologyCandidatesResponse & { code?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.candidates)) { setLoad({ state: "error", code: body?.code }); return; }
      setLoad({ state: "ready", data: { run: body.run, candidates: body.candidates } });
    } catch {
      setLoad({ state: "error" });
    }
  }, [collection]);

  useEffect(() => { void read(); }, [read]);

  const derive = async () => {
    if (!collection || deriving) return;
    setDeriving(true);
    setNotice({ text: copy.deriving, alert: false });
    try {
      const token = await authorization();
      const response = token ? await fetch("/api/ontology/candidates", {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify(collection),
      }) : null;
      const body = await response?.json().catch(() => null) as { code?: string } | null;
      if (!response?.ok) { setNotice({ text: schemaReviewError(copy, body?.code), alert: true }); return; }
      setNotice({ text: copy.derived, alert: false });
      await read();
    } catch {
      setNotice({ text: schemaReviewError(copy, undefined), alert: true });
    } finally {
      setDeriving(false);
    }
  };

  if (!collection) {
    return <section className={styles.panel} aria-labelledby="schema-review-title"><h2 id="schema-review-title">{copy.title}</h2><p>{copy.noWorld}</p></section>;
  }

  const data = load.state === "ready" ? load.data : null;
  const classes = data?.candidates.filter((candidate) => candidate.kind === "class") ?? [];
  const properties = data?.candidates.filter((candidate) => candidate.kind === "property") ?? [];
  const labels = new Map(classes.map((candidate) => [candidate.key, candidate.label]));

  return (
    <section className={styles.panel} aria-labelledby="schema-review-title" data-testid="schema-review">
      <h2 id="schema-review-title">{copy.title}</h2>
      <p>{copy.intro}</p>
      <p className={styles.note}>{copy.storedOnly}</p>
      {notice ? <p className={styles.notice} role={notice.alert ? "alert" : "status"}>{notice.text}</p> : null}
      {load.state === "loading" ? <p className={styles.note} role="status">{copy.loading}</p> : null}
      {load.state === "error" ? <p className={styles.notice} role="alert">{load.code ? schemaReviewError(copy, load.code) : copy.loadFailed}</p> : null}
      {data && !data.run ? (
        <div className={styles.empty}>
          <p>{copy.noRun}</p>
          <button type="button" className={styles.primary} onClick={() => void derive()} disabled={deriving}>{copy.derive}</button>
        </div>
      ) : null}
      {data?.run ? (
        <>
          <p className={styles.note}>{copy.proposedBy(formatTimestamp(data.run.createdAt) ?? data.run.createdAt)}</p>
          <CandidateGroup heading={copy.classes} candidates={classes} copy={copy} labels={labels} collectionId={collection.collectionId}
            onDecided={(text) => { setNotice({ text, alert: false }); void read(); }} onFailed={(text) => setNotice({ text, alert: true })} />
          <CandidateGroup heading={copy.properties} candidates={properties} copy={copy} labels={labels} collectionId={collection.collectionId}
            onDecided={(text) => { setNotice({ text, alert: false }); void read(); }} onFailed={(text) => setNotice({ text, alert: true })} />
        </>
      ) : null}
    </section>
  );
}

type GroupProps = {
  heading: string;
  candidates: readonly OntologyCandidate[];
  copy: SchemaReviewCopy;
  labels: ReadonlyMap<string, string>;
  collectionId: string;
  onDecided: (text: string) => void;
  onFailed: (text: string) => void;
};

function CandidateGroup({ heading, candidates, ...rest }: GroupProps) {
  return (
    <section className={styles.group} aria-label={heading}>
      <h3>{heading} <span className={styles.count}>{candidates.length}</span></h3>
      {candidates.length === 0 ? <p className={styles.note}>{rest.copy.emptyKind}</p> : (
        <ul className={styles.list}>
          {candidates.map((candidate) => <CandidateCard key={candidate.candidateId} candidate={candidate} {...rest} />)}
        </ul>
      )}
    </section>
  );
}

function CandidateCard({ candidate, copy, labels, collectionId, onDecided, onFailed }: Omit<GroupProps, "heading" | "candidates"> & { candidate: OntologyCandidate }) {
  const [open, setOpen] = useState<Verdict | null>(null);
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState(candidate.label);
  const [description, setDescription] = useState(candidate.description);
  const [busy, setBusy] = useState(false);
  const formId = `schema-decision-${candidate.candidateId}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!open || busy) return;
    setBusy(true);
    try {
      const token = await authorization();
      const response = token ? await fetch(`/api/ontology/candidates/${candidate.candidateId}`, {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify({ collectionId, verdict: open, reason, ...(open === "edit" ? { label, description } : {}) }),
      }) : null;
      const body = await response?.json().catch(() => null) as { code?: string } | null;
      if (!response?.ok) { onFailed(schemaReviewError(copy, body?.code)); return; }
      const verdict = open;
      setOpen(null);
      setReason("");
      onDecided(copy.saved[verdict]);
    } catch {
      onFailed(schemaReviewError(copy, undefined));
    } finally {
      setBusy(false);
    }
  };

  const headingId = `schema-candidate-${candidate.candidateId}`;
  return (
    <li className={styles.card} data-state={candidate.state} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h4 id={headingId} data-sensitive="content">{candidate.label}</h4>
        <span className={styles.state}>{copy.state[candidate.state]}</span>
      </div>
      {candidate.kind === "property" && candidate.domainKey && candidate.rangeKey ? (
        <p className={styles.signature} data-sensitive="content">
          {labels.get(candidate.domainKey) ?? candidate.domainKey} <span aria-hidden="true">→</span> {candidate.label} <span aria-hidden="true">→</span> {labels.get(candidate.rangeKey) ?? candidate.rangeKey}
        </p>
      ) : null}
      <p data-sensitive="content">{candidate.description}</p>
      {candidate.label !== candidate.proposedLabel ? <p className={styles.note}>{copy.proposedAs(candidate.proposedLabel)}</p> : null}
      <h5 className={styles.evidenceHeading}>{copy.evidenceHeading}</h5>
      <ol className={styles.evidence}>
        {candidate.evidence.map((item) => (
          <li key={item.evidenceId}>
            <blockquote data-sensitive="content">{item.quote}</blockquote>
            <p className={styles.where}>
              {copy.page(item.page)} · {copy.box} <span className={styles.mono}>{item.bbox.join(", ")}</span>
            </p>
          </li>
        ))}
      </ol>
      {candidate.history.length > 0 ? (
        <p className={styles.note}>
          {candidate.history.map((entry) => `${copy.history[entry.verdict]} ${formatTimestamp(entry.decidedAt) ?? ""}`.trim()).join(" · ")}
        </p>
      ) : null}
      {candidate.state === "proposed" ? (
        open ? (
          <form className={styles.form} id={formId} onSubmit={(event) => void submit(event)}>
            {open === "edit" ? (
              <>
                <label htmlFor={`${formId}-label`}>{copy.labelLabel}</label>
                <input id={`${formId}-label`} value={label} maxLength={120} required onChange={(event) => setLabel(event.target.value)} />
                <label htmlFor={`${formId}-description`}>{copy.descriptionLabel}</label>
                <textarea id={`${formId}-description`} value={description} maxLength={600} rows={3} onChange={(event) => setDescription(event.target.value)} />
              </>
            ) : null}
            <label htmlFor={`${formId}-reason`}>{copy.reasonLabel}</label>
            <textarea id={`${formId}-reason`} value={reason} minLength={8} maxLength={1000} rows={2} required aria-describedby={`${formId}-hint`}
              onChange={(event) => setReason(event.target.value)} autoFocus />
            <p id={`${formId}-hint`} className={styles.note}>{copy.reasonHint}</p>
            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={busy || reason.trim().length < 8}>{copy.submit[open]}</button>
              <button type="button" onClick={() => { setOpen(null); setReason(""); }} disabled={busy}>{copy.cancel}</button>
            </div>
          </form>
        ) : (
          <div className={styles.actions}>
            <button type="button" onClick={() => setOpen("certify")}>{copy.certify}</button>
            <button type="button" onClick={() => setOpen("reject")}>{copy.reject}</button>
            <button type="button" onClick={() => { setLabel(candidate.label); setDescription(candidate.description); setOpen("edit"); }}>{copy.edit}</button>
          </div>
        )
      ) : null}
    </li>
  );
}
