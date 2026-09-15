/*
  What an inquiry needs to say before anyone can answer it.

  Masterplan 13.4 asks the contact form for document volume, source types, target output,
  timeline, security and deployment requirement, and region. Today all of that lives in one free
  text box with a placeholder listing them, which means the ones a visitor forgets become a
  round trip -- and the round trip is what loses the inquiry.

  Every one of these is a closed list rather than a text field, for two reasons. A visitor
  answering a select cannot accidentally paste a customer document into it, which is the one
  thing this page tells them not to do. And a closed list is validatable on the server, so the
  message that reaches a mailbox carries values this code chose rather than values a submitter
  did -- the form is an unauthenticated write to an outbound channel, and free text in a
  notification is how those get abused.

  They are all optional. A visitor who only wants to ask a question should not have to answer a
  qualification questionnaire first.
*/

export type QualificationField = {
  name: string;
  label: string;
  /** Rendered above the control where the choice is not self-explanatory. */
  hint?: string;
  options: readonly string[];
  /** Several answers can be true at once, so this one renders as checkboxes. */
  multiple?: boolean;
};

export const QUALIFICATION: readonly QualificationField[] = [
  {
    name: "volume",
    label: "Estimated document volume",
    options: ["Not known yet", "Under 100", "100 to 1,000", "1,000 to 10,000", "More than 10,000"],
  },
  {
    name: "sources",
    label: "Source types",
    hint: "Choose every one that applies.",
    multiple: true,
    options: [
      "Scanned PDFs",
      "Digital PDFs",
      "Office documents",
      "Drawings or diagrams",
      "Google Drive, SharePoint or Dropbox",
      "An existing wiki or database",
    ],
  },
  {
    name: "output",
    label: "What the knowledge is for",
    options: [
      "Not decided",
      "Grounded answers for a team",
      "A knowledge source an agent reads",
      "A reviewed knowledge graph",
      "A portable export into our own stack",
    ],
  },
  {
    name: "timeline",
    label: "Timeline",
    options: ["Exploring", "Within a quarter", "Within a month", "Already committed"],
  },
  /*
    G2-024, 2026-09-16. A form field is a promise, and these two were promising twice.

    "Deployment requirement: Air-gapped or on-premise" and "Data region requirement: Korea / EU /
    UK / US" read as a menu of things we can deliver. Nothing on the site supports either: there
    is one managed deployment, `/security` says no data residency is guaranteed, and
    `/subprocessors` publishes the region each service is configured for rather than a region a
    customer may pick. A visitor ticking "Air-gapped" was being told we have one.

    The questions stay, because the answers are genuinely useful to whoever replies: knowing that
    a prospect needs EU residency is how the first reply says so honestly, instead of two rounds
    later. What changed is the word. They ask what you would prefer, and each label states that
    not every answer is available today. The `name` values are untouched --
    `contact-qualification.test.ts` pins them and the server's allow-list is keyed on them.
  */
  {
    name: "deployment",
    label: "Deployment preference (one managed deployment is offered today)",
    options: ["Not decided", "Managed by TAVONEL", "Our own cloud account", "Air-gapped or on-premise"],
  },
  {
    name: "region",
    label: "Data region preference (not all regions are offered today)",
    options: ["Not decided", "Korea", "European Union", "United Kingdom", "United States", "Elsewhere"],
  },
] as const;

const BY_NAME = new Map(QUALIFICATION.map((field) => [field.name, field] as const));

/**
 * The answers, or null if any of them is not one this form offered.
 *
 * Fails closed rather than dropping the offending value: a submission carrying a option nobody
 * could have selected is not a visitor with an unusual answer, and passing the rest of it along
 * as though nothing happened would hide that.
 */
export function parseQualification(raw: Record<string, unknown>): Record<string, string[]> | null {
  const answers: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = BY_NAME.get(key);
    if (!field) continue;
    const chosen = (Array.isArray(value) ? value : [value])
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    if (chosen.length === 0) continue;
    if (!chosen.every((entry) => field.options.includes(entry))) return null;
    if (!field.multiple && chosen.length > 1) return null;
    answers[key] = chosen;
  }
  return answers;
}

/** The answered fields, in the order the form asked them, for a mail body. */
export function qualificationLines(answers: Record<string, string[]>) {
  return QUALIFICATION
    .filter((field) => (answers[field.name]?.length ?? 0) > 0)
    .map((field) => ({ label: field.label, value: answers[field.name]!.join(", ") }));
}
