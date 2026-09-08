"use client";

import { useState } from "react";
import { CLAIM_STATE, type ClaimStateKey } from "@/lib/claim-state";
import { trackFunnel } from "@/lib/funnel-events";
import type { CapabilityManifest, CapabilityManifestEntry } from "../../shared/capabilityManifest";
import { capabilityStatuses, type CapabilityStatus, type SourceFamily } from "../../shared/uskcEnums";

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

/*
  Most common first, and a way to get to one family without reading past the others (§14.3).

  The manifest's own order is the order the formats were added to the intake whitelist, which is
  a fact about this repository's history and not about what a visitor came to look up. A buyer
  asking "can it read my files" is holding a PDF or a scan far more often than an ODS, so the
  families are ordered by how often they are the reason someone opened this page, and the
  ordering is stated here rather than by reordering the manifest -- that file is the server's
  whitelist and its order has no business being a presentation decision.

  A family absent from the manifest simply never renders a button; the list is derived, so
  adding a format to the manifest adds its family here without a second edit.
*/
const FAMILY_ORDER: readonly SourceFamily[] = ["document", "image", "spreadsheet", "presentation", "archive"];

const FAMILY_LABEL: Partial<Record<SourceFamily, string>> = {
  document: "Documents and PDFs",
  image: "Scans and images",
  spreadsheet: "Spreadsheets",
  presentation: "Presentations",
  archive: "Archives",
};

function familyRank(family: SourceFamily) {
  const at = FAMILY_ORDER.indexOf(family);
  return at === -1 ? FAMILY_ORDER.length : at;
}

export default function SourceCapabilityTable({ manifest }: { manifest: CapabilityManifest }) {
  const [family, setFamily] = useState<SourceFamily | "all">("all");
  const ordered = [...manifest.entries].sort((a, b) => familyRank(a.sourceFamily) - familyRank(b.sourceFamily));
  const families = FAMILY_ORDER.filter((name) => ordered.some((entry) => entry.sourceFamily === name));
  const rows = family === "all" ? ordered : ordered.filter((entry) => entry.sourceFamily === family);

  const choose = (next: SourceFamily | "all") => {
    setFamily(next);
    // The family name is one of the frozen enum values, not anything the visitor typed.
    trackFunnel("source_category_viewed", { family: next });
  };

  return (
    <>
      {/*
        The quick navigator is a filter, not a set of anchors.

        Anchors down a twelve-row table move the viewport and leave the reader to work out
        which rows belong to the heading they landed on. Filtering answers the question the
        page is actually asked -- "is my kind of file in here" -- and leaves the row count
        visible so a reader can see that filtering removed something rather than that the page
        broke. It is sticky because on a phone the table is taller than the screen and the
        control that narrows it must not scroll away above it.
      */}
      <div className="src-filter" role="group" aria-label="Filter by source type">
        <button type="button" data-on={family === "all" ? 1 : 0} onClick={() => choose("all")} aria-pressed={family === "all"}>
          All formats <i>{ordered.length}</i>
        </button>
        {families.map((name) => (
          <button
            key={name}
            type="button"
            data-on={family === name ? 1 : 0}
            aria-pressed={family === name}
            onClick={() => choose(name)}
          >
            {FAMILY_LABEL[name] ?? words(name)}{" "}
            <i>{ordered.filter((entry) => entry.sourceFamily === name).length}</i>
          </button>
        ))}
      </div>

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
            {rows.map((entry) => <Row key={entry.mime} entry={entry} />)}
          </tbody>
        </table>
      </div>

      {/*
        The tier legend is a technical detail, so it starts closed (§14.3).

        Six definitions of six frozen status words is the right thing to have on the page and
        the wrong thing to put between a reader and the table: it was two screens of vocabulary
        immediately below the rows the vocabulary describes. The chip in each row still prints
        the tier name, so nothing is hidden -- what folds is the paragraph explaining it, for
        the reader who wants it.
      */}
      <details className="status-fold">
        <summary>What each support tier means</summary>
        <dl className="src-legend">
          {capabilityStatuses.map((status) => (
            <div key={status}>
              <dt>
                <span className="src-tier" data-token={TIERS[status].token}>{status}</span>
              </dt>
              <dd>{TIERS[status].meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
