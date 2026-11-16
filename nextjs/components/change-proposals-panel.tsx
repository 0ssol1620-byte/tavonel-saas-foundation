"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicProposal, ProposalState } from "@/lib/change-proposals";
import styles from "./change-proposals-panel.module.css";

/*
  Proposals in Changes (WO-D30-3): requests for a change to the World, waiting for a person.
  Creating a proposal changed nothing; the preview is the change it would make. Confirm and Reject
  exist only while a proposal is Proposed, Undo only once it is Done. Every control is chosen from the
  state the server last returned. A click never assumes its own outcome: the list is read again
  afterwards, and a lost response says it could not be confirmed instead of announcing success.
*/

type Props = { collectionId: string | null };
type Load = { state: "loading" } | { state: "unavailable" } | { state: "ready"; proposals: PublicProposal[] };
type Action = "confirm" | "reject" | "undo";

const STATE_WORD: Record<ProposalState, string> = {
  proposed: "Proposed", confirmed: "Confirmed", executed: "Done", rejected: "Rejected",
  expired: "Expired", stale: "Out of date", failed: "Failed", undone: "Undone",
};
const REFUSED: Record<number, string> = {
  403: "You can not decide on this proposal.",
  409: "This proposal can no longer be changed. The list now shows the latest.",
};

async function api(path: string, init: RequestInit = {}) {
  const client = getSupabaseBrowserClient();
  const token = client ? (await client.auth.getSession()).data.session?.access_token ?? null : null;
  return fetch(path, { ...init, cache: "no-store", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}) } });
}

async function fetchProposals(collectionId: string): Promise<Load> {
  try {
    const response = await api(`/api/proposals?collectionId=${encodeURIComponent(collectionId)}`);
    const body = await response.json().catch(() => null) as { proposals?: PublicProposal[] } | null;
    if (!response.ok || !body || !Array.isArray(body.proposals)
      || !body.proposals.every((p) => p && p.state in STATE_WORD && typeof p.proposalId === "string" && Array.isArray(p.evidenceIds))) return { state: "unavailable" };
    return { state: "ready", proposals: [...body.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  } catch {
    return { state: "unavailable" };
  }
}

export default function ChangeProposalsPanel({ collectionId }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (collectionId) setLoad(await fetchProposals(collectionId));
  }, [collectionId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function act(proposalId: string, action: Action) {
    setBusy(proposalId);
    setProblem(null);
    try {
      let status: number;
      try {
        const response = await api(`/api/proposals/${proposalId}/${action === "undo" ? "undo" : "decision"}`, { method: "POST",
          body: JSON.stringify(action === "undo" ? { collectionId } : { collectionId, decision: action }) });
        status = response.ok ? 200 : response.status;
      } catch {
        status = 0;
      }
      if (status === 0) setProblem("The response could not be confirmed. The list below was read again and shows what was recorded.");
      else if (status !== 200) setProblem(REFUSED[status] ?? "The decision was not saved. Try again.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!collectionId) return null;
  if (load.state === "loading") return <section className={styles.surface} aria-busy="true"><p className={styles.note}>Reading proposals…</p></section>;
  if (load.state === "unavailable") {
    return (
      <section className={styles.surface}>
        <h2>Proposals</h2>
        <p className={styles.note} role="status">Proposals could not be read. Nothing is shown rather than a partial list.</p>
        <button type="button" className={styles.action} onClick={() => { setLoad({ state: "loading" }); void refresh(); }}>Try again</button>
      </section>
    );
  }

  return (
    <section className={styles.surface} aria-labelledby="change-proposals-title">
      <div className={styles.intro}>
        <h2 id="change-proposals-title">Proposals</h2>
        <p>A proposal changes nothing until a person confirms it. Confirm or reject each one; a confirmed change can be undone.</p>
      </div>
      {problem ? <p className={styles.problem} role="status">{problem}</p> : null}
      {load.proposals.length === 0 ? <p className={styles.empty}>No proposals.</p> : (
        <ul className={styles.list}>
          {load.proposals.map((proposal) => {
            const { preview } = proposal;
            const disabled = busy !== null;
            return (
              <li key={proposal.proposalId} className={styles.row} data-state={proposal.state}>
                <span className={styles.state}>{STATE_WORD[proposal.state]}</span>
                {preview ? (
                  <p className={styles.preview}>
                    {preview.decision === "confirmed" ? "Confirm" : "Reject"} {preview.labelKind === "doc_type" ? "type" : "topic"}{" "}
                    <strong>{preview.labelKey.replace(/_/g, " ")}</strong> on <span className={styles.id}>{preview.documentId}</span>
                  </p>
                ) : <p className={styles.note}>The change is not shown for this proposal.</p>}
                {proposal.evidenceIds.length > 0 ? <p className={styles.note}>Evidence: <span className={styles.id}>{proposal.evidenceIds.join(", ")}</span></p> : null}
                <div className={styles.actions}>
                  {proposal.state === "proposed" ? (["confirm", "reject"] as const).map((action) => (
                    <button key={action} type="button" className={styles.action} disabled={disabled} onClick={() => void act(proposal.proposalId, action)}>
                      {action === "confirm" ? "Confirm" : "Reject"}
                    </button>
                  )) : null}
                  {proposal.state === "executed" ? (
                    <button type="button" className={styles.action} disabled={disabled} onClick={() => void act(proposal.proposalId, "undo")}>Undo</button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
