import { CLAIM_STATE, type ClaimStateKey } from "@/lib/claim-state";
import type { CapabilityManifest, CapabilityManifestEntry } from "../../shared/capabilityManifest";
import { CAPABILITY_STATUSES, type CapabilityStatus } from "../../shared/uskcEnums";

/*
  The support matrix, printed from the manifest.

  Six tiers, four colours. `tavonel.css` has exactly four status tokens and this page does not
  get a fifth: a new hue would have to mean something, and the thing it would mean is already
  said by the tier name printed inside the chip. The rule the four encode is what the deployment
  owes the reader, not how good the format is --

    --verified    a qualification receipt exists                 VERIFIED_NATIVE, VERIFIED_HYBRID
    --unresolved  it reads, and no one has qualified how well    BEST_EFFORT, METADATA_ONLY
    --changed     a person has to decide before it proceeds      REVIEW_REQUIRED
    --reused      inert; nothing is compiled                     UNSUPPORTED

  -- which is the same partition `lib/claim-state.ts` makes over claims, so each tier also names
  the claim state a row licenses. That file had no production consumer until this page.
*/
type Tier = {
  meaning: string;
  claim: ClaimStateKey;
  token: "verified" | "unresolved" | "changed" | "reused";
};

const TIERS: Record<CapabilityStatus, Tier> = {
  VERIFIED_NATIVE: {
    meaning: "Read by a native reader for the format, with a qualification receipt behind it.",
    claim: "qualified",
    token: "verified",
  },
  VERIFIED_HYBRID: {
    meaning: "Read natively and cross-checked against a render or OCR pass, with a qualification receipt behind it.",
    claim: "qualified",
    token: "verified",
  },
  BEST_EFFORT: {
    meaning: "Extracted by a general-purpose path. Useful, and not a guarantee that every structure in the source survived.",
    claim: "demonstrated",
    token: "unresolved",
  },
  METADATA_ONLY: {
    meaning: "Handled at the type, metadata or container level only. No content is read.",
    claim: "demonstrated",
    token: "unresolved",
  },
  REVIEW_REQUIRED: {
    meaning: "Encrypted, damaged or proprietary in a way that needs a person before anything is compiled.",
    claim: "humanGate",
    token: "changed",
  },
  UNSUPPORTED: {
    meaning: "Refused. Nothing about the source is compiled.",
    claim: "blocked",
    token: "reused",
  },
};

/** Manifest tokens are snake_case so they can be compared; a reader gets them as words. */
function words(token: string) {
  return token.replaceAll("_", " ");
}

function TokenList({ values }: { values: readonly string[] }) {
  if (values.length === 0) return <span className="src-none">none</span>;
  return (
    <ul className="src-tokens">
      {values.map((value) => <li key={value}>{words(value)}</li>)}
    </ul>
  );
}

function Row({ entry }: { entry: CapabilityManifestEntry }) {
  const tier = TIERS[entry.status];
  return (
    <tr>
      <th scope="row" data-label="Source">
        <b>{entry.extensions.map((extension) => `.${extension}`).join(" ")}</b>
        <i>{entry.mime}</i>
        <i>{words(entry.sourceFamily)}</i>
      </th>
      <td data-label="Support tier">
        <span className="src-tier" data-token={tier.token}>{entry.status}</span>
        <i>{CLAIM_STATE[tier.claim].label}</i>
      </td>
      <td data-label="What is preserved"><TokenList values={entry.preserved} /></td>
      <td data-label="Visual verification"><TokenList values={entry.visual} /></td>
      <td data-label="Evidence locator"><TokenList values={entry.evidenceLocatorKinds} /></td>
      <td data-label="Known limitations"><TokenList values={entry.knownLimitations} /></td>
    </tr>
  );
}

export default function SourceCapabilityTable({ manifest }: { manifest: CapabilityManifest }) {
  return (
    <>
      <div className="src-scroll">
        <table className="src-matrix">
          <caption>
            Generated from {manifest.generatedFrom}. Anything not listed is{" "}
            {manifest.defaultStatus.toLowerCase()}.
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Support tier</th>
              <th scope="col">What is preserved</th>
              <th scope="col">Visual verification</th>
              <th scope="col">Evidence locator</th>
              <th scope="col">Known limitations</th>
            </tr>
          </thead>
          <tbody>
            {manifest.entries.map((entry) => <Row key={entry.mime} entry={entry} />)}
          </tbody>
        </table>
      </div>

      <dl className="src-legend">
        {CAPABILITY_STATUSES.map((status) => (
          <div key={status}>
            <dt>
              <span className="src-tier" data-token={TIERS[status].token}>{status}</span>
            </dt>
            <dd>{TIERS[status].meaning}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
