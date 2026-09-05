"use client";

import { useEffect, useMemo, useState } from "react";
import WorldVersionDiffPanel from "@/components/world-version-diff";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { formatCount, formatTimestamp } from "@/lib/format";
import { displayName, type DocumentNames } from "@/lib/document-names";
import {
  describeChangeImpact,
  objectLabels,
  pairScopedModel,
  readChangeInbox,
  readKnowledgeImpact,
  readSourceDiff,
  summariseChangeImpact,
  type ChangeGroupCounts,
} from "@/lib/change-inbox";
import { diffWorldVersions } from "@/lib/world-version-diff";
import type { WorldHistoryEntry, WorldReadModel } from "@/lib/world-read-model";
import styles from "./change-inbox.module.css";

/*
  The Change Inbox.

  A workspace that only ever shows the current World answers "what do I know" and never answers
  "what just changed", which is the question an operator actually arrives with. This surface is
  built entirely out of the World's own version history: consecutive versions are the change
  records, and every number beside them comes from comparing the two compiled artifacts through
  `diffWorldVersions`.

  Nothing here is estimated. A pair whose other side cannot be read says so and shows no count;
  a World with one version says a first compile is not a change; a workspace with no World says
  to compile one. The one thing this panel must never do is print a plausible number.
*/

type Props = {
  model: WorldReadModel | null;
  /** Null when no collection is loaded, which is how "no World yet" is told from "cannot read". */
  collectionId: string | null;
  /** Filenames this browser remembers, so a source reads as a document rather than as an id. */
  names: DocumentNames;
};

type PairModels = { id: string; before: WorldReadModel; after: WorldReadModel };

async function authToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

/** The readable head of a manifest digest, without the `sha256:` prefix. */
function shortDigest(digest: string) {
  return digest.slice(7, 19);
}

function activationLabel(entry: WorldHistoryEntry) {
  if (entry.activatedAt.state !== "read") return entry.activatedAt.reason;
  return formatTimestamp(entry.activatedAt.value) ?? entry.activatedAt.value;
}

function groupLabel(group: ChangeGroupCounts) {
  return [
    group.changed > 0 ? `${formatCount(group.changed)} changed` : null,
    group.added > 0 ? `${formatCount(group.added)} added` : null,
    group.removed > 0 ? `${formatCount(group.removed)} removed` : null,
  ].filter((part): part is string => part !== null).join(" · ");
}

export default function ChangeInbox({ model, collectionId, names }: Props) {
  const reading = useMemo(() => readChangeInbox(model, collectionId), [model, collectionId]);
  const transitions = useMemo(() => (reading.state === "read" ? reading.transitions : []), [reading]);
  const history = useMemo(() => ("history" in reading ? reading.history : []), [reading]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pair, setPair] = useState<PairModels | null>(null);
  const [pairState, setPairState] = useState<"idle" | "loading" | "unavailable">("idle");
  const [inspecting, setInspecting] = useState(false);

  // Newest transition first, and stay on the chosen one while the model refreshes under it.
  useEffect(() => {
    setSelectedId((previous) => (previous && transitions.some((item) => item.id === previous)
      ? previous
      : transitions[0]?.id ?? null));
  }, [transitions]);

  useEffect(() => { setInspecting(false); }, [selectedId]);

  const selected = transitions.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!model || !selected) { setPair(null); setPairState("idle"); return; }
    const worldId = model.world.id;
    const onScreen = model.world.manifestDigest;
    const transition = selected;
    let cancelled = false;
    setPairState("loading");
    const load = async (digest: string): Promise<WorldReadModel | null> => {
      // The version already on screen is the artifact the page loaded; re-reading it would be a
      // second request for bytes we hold.
      if (digest === onScreen) return model;
      const token = await authToken();
      if (!token) return null;
      const response = await fetch(
        `/api/v1/world/${encodeURIComponent(worldId)}?manifest=${encodeURIComponent(digest)}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!response.ok) return null;
      const body = await response.json().catch(() => ({})) as { model?: WorldReadModel };
      return body.model ?? null;
    };
    void (async () => {
      const [before, after] = await Promise.all([
        load(transition.before.manifestDigest),
        load(transition.after.manifestDigest),
      ]);
      if (cancelled) return;
      if (!before || !after) { setPair(null); setPairState("unavailable"); return; }
      setPair({ id: transition.id, before, after });
      setPairState("idle");
    })().catch(() => {
      if (!cancelled) { setPair(null); setPairState("unavailable"); }
    });
    return () => { cancelled = true; };
  }, [model, selected]);

  const diff = useMemo(
    () => (pair && pair.id === selectedId ? diffWorldVersions(pair.before, pair.after) : null),
    [pair, selectedId],
  );
  const counts = useMemo(() => (diff ? summariseChangeImpact(diff) : null), [diff]);
  const sourceLines = useMemo(() => (diff ? readSourceDiff(diff) : []), [diff]);
  const knowledgeLines = useMemo(
    () => (diff && pair ? readKnowledgeImpact(diff, objectLabels(pair.before, pair.after)) : []),
    [diff, pair],
  );

  return (
    <section id="workspace-changes" className={`card ${styles.surface}`} aria-labelledby="workspace-changes-title">
      <div className={styles.intro}>
        <p className="eyebrow">CHANGES</p>
        <h2 id="workspace-changes-title">What changed, and what it changed.</h2>
        <p>
          Every row is a transition between two compiled versions of this World. The counts are
          read by comparing both artifacts; nothing on this surface is estimated between them.
        </p>
      </div>

      {reading.state !== "read" ? (
        <div className={styles.state} role="status" data-state={reading.state}>
          <span>{reading.state === "unavailable" ? "UNAVAILABLE" : reading.state === "single" ? "NO CHANGE YET" : "NOT COMPILED YET"}</span>
          <p>{reading.reason}</p>
        </div>
      ) : (
        <div className={styles.split}>
          <ol className={styles.inbox} aria-label="Change records, newest first">
            {transitions.map((transition) => {
              const current = transition.id === selectedId;
              return (
                <li key={transition.id}>
                  <button
                    type="button"
                    aria-pressed={current}
                    data-current={current}
                    onClick={() => setSelectedId(transition.id)}
                  >
                    <span className={styles.rowVersions}>
                      <strong>{transition.before.version}</strong>
                      <i aria-hidden="true">→</i>
                      <strong>{transition.after.version}</strong>
                    </span>
                    <code>{shortDigest(transition.before.manifestDigest)} → {shortDigest(transition.after.manifestDigest)}</code>
                    <small>{activationLabel(transition.after)}</small>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className={styles.detail}>
            {selected ? (
              <>
                <h3>
                  {selected.before.version} <i aria-hidden="true">→</i> {selected.after.version}
                  <span className={styles.status}>{selected.after.status}</span>
                </h3>

                {pairState === "loading" ? <p className={styles.note}>Reading both compiled versions…</p> : null}
                {pairState === "unavailable" ? (
                  <p className={styles.note} role="status">
                    One side of this comparison could not be read, so no count is shown for it.
                    Nothing was changed.
                  </p>
                ) : null}

                {counts ? (
                  <>
                    <p className={styles.summary}>{describeChangeImpact(counts)}</p>
                    <dl className={styles.counts}>
                      {counts.objects.changed + counts.objects.added + counts.objects.removed > 0 ? (
                        <div><dt>Objects</dt><dd>{groupLabel(counts.objects)}</dd></div>
                      ) : null}
                      {counts.relations.changed + counts.relations.added + counts.relations.removed > 0 ? (
                        <div><dt>Relations</dt><dd>{groupLabel(counts.relations)}</dd></div>
                      ) : null}
                      {counts.evidence.changed + counts.evidence.added + counts.evidence.removed > 0 ? (
                        <div><dt>Evidence regions</dt><dd>{groupLabel(counts.evidence)}</dd></div>
                      ) : null}
                      {counts.files.changed + counts.files.added + counts.files.removed > 0 ? (
                        <div><dt>Package files</dt><dd>{groupLabel(counts.files)}</dd></div>
                      ) : null}
                      <div>
                        <dt>Source revisions</dt>
                        <dd>
                          {formatCount(counts.sourceRevisions.unchanged)} unchanged
                          {counts.sourceRevisions.added > 0 ? ` · ${formatCount(counts.sourceRevisions.added)} added` : ""}
                          {counts.sourceRevisions.removed > 0 ? ` · ${formatCount(counts.sourceRevisions.removed)} removed` : ""}
                        </dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      className={styles.inspect}
                      aria-expanded={inspecting}
                      onClick={() => setInspecting((open) => !open)}
                    >
                      {inspecting ? "Hide impact" : "Inspect impact"}
                    </button>
                  </>
                ) : null}

                {inspecting && diff && pair ? (
                  <div className={styles.impact}>
                    <section aria-labelledby="change-source-diff">
                      <h4 id="change-source-diff">SOURCE DIFF</h4>
                      {sourceLines.length === 0 ? (
                        <p className={styles.note}>No evidence region differs between these versions.</p>
                      ) : (
                        <ul className={styles.lines}>
                          {sourceLines.map((entry) => (
                            <li key={`${entry.evidenceId}:${entry.field}`}>
                              <span className={styles.where}>
                                {displayName(entry.sourceId, names)} · page {entry.page}
                              </span>
                              <b>{entry.field}</b>
                              <s data-sensitive="content">{entry.before || "—"}</s>
                              <ins data-sensitive="content">{entry.after || "—"}</ins>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section aria-labelledby="change-knowledge-impact">
                      <h4 id="change-knowledge-impact">KNOWLEDGE IMPACT</h4>
                      {knowledgeLines.length === 0 ? (
                        <p className={styles.note}>No compiled object or relation differs between these versions.</p>
                      ) : (
                        <ul className={styles.lines}>
                          {knowledgeLines.map((entry) => (
                            <li key={`${entry.kind}:${entry.id}`} data-effect={entry.effect}>
                              <span className={styles.where}>{entry.type} · {entry.effect}</span>
                              <b data-sensitive="content">{entry.label}</b>
                              {entry.fields.length > 0 ? <small>{entry.fields.join(", ")}</small> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <div className={styles.full}>
                      <h4>FIELD-LEVEL COMPARISON</h4>
                      {/*
                        The comparison panel the Versions lens already uses, opened on this pair
                        rather than on its own default. It reads the older side itself, from the
                        same versioned endpoint, so the detail below is the same artifact the
                        counts above were derived from.
                      */}
                      <WorldVersionDiffPanel model={pairScopedModel(pair.after, selected)} />
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/*
        The history is drawn only when a World reported one. Repeating the sentence above under
        a second heading would make an outage look like two separate findings.
      */}
      {history.length > 0 ? (
      <section className={styles.timeline} aria-labelledby="workspace-world-history">
        <h3 id="workspace-world-history">World history</h3>
        <ol className={styles.versions}>
          {history.map((entry) => (
            <li key={`${entry.version}:${entry.manifestDigest}`} data-status={entry.status}>
              <span className={styles.status}>{entry.status}</span>
              <strong>{entry.version}</strong>
              <code>{shortDigest(entry.manifestDigest)}</code>
              <small>{activationLabel(entry)}</small>
              <small>
                {entry.activationCount.state === "read"
                  ? `${formatCount(entry.activationCount.value)} activation${entry.activationCount.value === 1 ? "" : "s"}`
                  : entry.activationCount.reason}
              </small>
            </li>
          ))}
        </ol>
      </section>
      ) : null}
    </section>
  );
}
