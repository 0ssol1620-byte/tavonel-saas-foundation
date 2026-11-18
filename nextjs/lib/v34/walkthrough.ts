/**
 * Home reference walkthrough (D33 §3.9): four steps over one public source, NIST SP 800-53
 * Rev. 5 and its 2025-08-27 Release 5.2.0 / SA-24 change. Plain module, safe on server and client.
 * Every fact is taken from the public reference corpus records `nist`, `release` and `sa24`.
 */

export const WALKTHROUGH_LABEL = "Reference walkthrough";
export const WALKTHROUGH_ANSWER_LABEL = "Reference answer";
/** Corpus record ids the steps cite; the test checks them against the corpus snapshot. */
export const WALKTHROUGH_RECORD_IDS = ["nist", "release", "sa24"] as const;

const NEWS_URL = "https://csrc.nist.gov/News/2025/nist-releases-revision-to-sp-800-53-controls";
const PUBLICATION_URL = "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final";

export interface WalkthroughRecord {
  /** Kind label shown on the record card. */
  readonly kind: string;
  readonly title: string;
  /** Date / relation line under the title. */
  readonly meta: string;
  readonly url: string;
  readonly linkLabel: string;
}

export interface WalkthroughStep {
  readonly label: string;
  readonly heading: string;
  readonly body: string;
  readonly record: WalkthroughRecord;
  /** Action label that moves to the following step; the last one returns to the first. */
  readonly nextLabel: string;
}

export const WALKTHROUGH_STEPS: readonly WalkthroughStep[] = [
  {
    label: "Connect",
    heading: "Start with what you already have.",
    body: "A document is more than text. Preserve its original identity, source and revision.",
    record: {
      kind: "Source record",
      title: "NIST SP 800-53 / Rev. 5",
      meta: "Official announcement · August 27, 2025",
      url: NEWS_URL,
      linkLabel: "Read the official release",
    },
    nextLabel: "Next: Compile",
  },
  {
    label: "Compile",
    heading: "Make the meaning addressable.",
    body: "Separate source, revision and concept so an agent can reuse a precise record rather than a loose summary.",
    record: {
      kind: "Knowledge object",
      title: "SA-24 · Design for Cyber Resiliency",
      meta: "Concept · new control in Release 5.2.0",
      url: PUBLICATION_URL,
      linkLabel: "Inspect the publication",
    },
    nextLabel: "Next: Keep current",
  },
  {
    label: "Keep current",
    heading: "A revision changes what you know.",
    body: "The release and control are explicitly linked. A review can follow that dependency without deciding compliance automatically.",
    record: {
      kind: "Recorded relationship",
      title: "Release 5.2.0 → SA-24",
      meta: "Relation: addresses · status: changed",
      url: NEWS_URL,
      linkLabel: "Inspect the change",
    },
    nextLabel: "Next: Use with AI",
  },
  {
    label: "Use with AI",
    heading: "Give your agent the evidence.",
    body: "A scoped answer returns the source passages it rests on, each with its location in the source.",
    record: {
      kind: WALKTHROUGH_ANSWER_LABEL,
      title: "SA-24 was added in Release 5.2.0.",
      meta: "Applicability to a particular organization needs review.",
      url: NEWS_URL,
      linkLabel: "Verify the answer",
    },
    nextLabel: "Start again",
  },
];
