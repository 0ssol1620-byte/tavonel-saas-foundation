import { formatTimestamp } from "@/lib/format";

/*
  Four times and one warning (audit TM04).

  "Current" was doing too much work. A World can be current in four different senses -- when the
  source was observed, when it was processed, when a person reviewed it, when it was activated --
  and the gaps between them are exactly what a consumer needs to see, because a consumer reads
  the *active* World. If a newer candidate is sitting there unactivated, every answer being
  handed out right now comes from the previous one. That is a safety property, not a bug, and it
  is only safe if it is said.

  The block is produced by the read model (L2's contract shape). The type is declared here from
  that contract rather than imported, and read defensively: an absent or malformed block renders
  nothing at all. Nulls are real nulls -- a missing timestamp prints as "not recorded", never as
  a substituted one.
*/

export type WorldFreshness = {
  observedAt: string | null;
  processedAt: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  activeManifestDigest: string | null;
  candidateAwaitingActivation: boolean;
  candidateManifestDigest: string | null;
};

const CANDIDATE_WAITING_NOTICE =
  "A newer candidate is waiting for activation; consumers are reading the previous active World";

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0 && value.length <= 256) return value;
  return undefined;
}

/**
 * Accept the contract shape and nothing else.
 *
 * Returns null when the field is absent or any member is the wrong type, so a read-model that
 * has not shipped the block yet renders nothing instead of an invented "unknown" row.
 */
export function readWorldFreshness(value: unknown): WorldFreshness | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.candidateAwaitingActivation !== "boolean") return null;
  const observedAt = nullableString(raw.observedAt);
  const processedAt = nullableString(raw.processedAt);
  const reviewedAt = nullableString(raw.reviewedAt);
  const activatedAt = nullableString(raw.activatedAt);
  const activeManifestDigest = nullableString(raw.activeManifestDigest);
  const candidateManifestDigest = nullableString(raw.candidateManifestDigest);
  if ([observedAt, processedAt, reviewedAt, activatedAt, activeManifestDigest, candidateManifestDigest]
    .some((entry) => entry === undefined)) return null;
  return {
    observedAt: observedAt as string | null,
    processedAt: processedAt as string | null,
    reviewedAt: reviewedAt as string | null,
    activatedAt: activatedAt as string | null,
    activeManifestDigest: activeManifestDigest as string | null,
    candidateAwaitingActivation: raw.candidateAwaitingActivation,
    candidateManifestDigest: candidateManifestDigest as string | null,
  };
}

const ROWS: Array<[keyof WorldFreshness, string, string]> = [
  ["observedAt", "OBSERVED", "when the source itself was last seen to change"],
  ["processedAt", "PROCESSED", "when the compile settled"],
  ["reviewedAt", "REVIEWED", "when a person last decided on it"],
  ["activatedAt", "ACTIVE SINCE", "when this revision became the one consumers read"],
];

export default function WorldFreshness({ freshness }: { freshness: unknown }) {
  const read = readWorldFreshness(freshness);
  if (!read) return null;
  return (
    <section className="card" aria-labelledby="world-freshness-title">
      <p className="eyebrow">FRESHNESS</p>
      <h2 id="world-freshness-title">What &ldquo;current&rdquo; means for this World, in four times.</h2>
      <div className="binding-list" aria-label="World freshness">
        {ROWS.map(([field, label, help]) => {
          const value = read[field] as string | null;
          return (
            <span key={label}>
              <b>{label}</b>
              {value === null ? `not recorded — ${help}` : `${formatTimestamp(value) ?? value} — ${help}`}
            </span>
          );
        })}
        {read.activeManifestDigest ? (
          <span><b>ACTIVE DIGEST</b>{read.activeManifestDigest.replace("sha256:", "").slice(0, 12)}</span>
        ) : null}
      </div>
      {read.candidateAwaitingActivation ? (
        <p className="fine held" role="status">
          {CANDIDATE_WAITING_NOTICE}
          {read.candidateManifestDigest
            ? `. The waiting candidate is ${read.candidateManifestDigest.replace("sha256:", "").slice(0, 12)}.`
            : "."}
          {" "}Activation is a human decision and nothing reads the candidate until it is made.
        </p>
      ) : null}
    </section>
  );
}
