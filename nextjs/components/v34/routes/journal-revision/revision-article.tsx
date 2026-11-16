import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ArticleLayout, type ArticleBlock } from "@/components/v34/ui/article-layout";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { v34Route } from "@/lib/v34/routes";
import { articleDates } from "../journal/article-dates";
import { RevisionCover } from "../journal/covers";
import { ReadNext } from "../journal/read-next";
import { MethodFigure } from "./figures";
import { REVISION_SOURCES } from "./revision-sources";

/*
  A revision of a standard, read as a change record. The NIST facts (the announcement date, the
  release number and the subject of the change) are the ones the announcement states; every other
  sentence describes a method. The example instructions are labelled placeholders.
*/

const ROUTE = "journal-revision";
const record = v34Route(ROUTE);

export const REVISION_DEK = "A workflow for tracking superseded instructions and tracing an approved answer to the source it came from.";

export const REVISION_BLOCKS: readonly ArticleBlock[] = [
  { kind: "h2", text: "A familiar problem in technical support" },
  { kind: "p", text: "Two manuals can use the same product name and give different instructions. A search result may quote a previous revision while the technician works on the latest hardware. The remedy is a revision-aware procedure: resolve which edition applies, then answer from it." },
  {
    kind: "figure",
    node: (
      <Figure
        kind="Sample"
        framed={false}
        caption="Two revisions of one instruction, with placeholder labels. They outline the record, and the instructions themselves are for illustration only."
        art={
          <ScrollTable
            label="Two revisions of one instruction and what the record keeps for each"
            columns={["Revision", "Instruction", "What the record keeps"]}
            rows={[
              ["Prior revision", "Instruction A", "Source and effective conditions, retained for historical cases."],
              ["New revision", "Instruction B", "A review flag: verify applicability and changed steps before approval."],
            ]}
          />
        }
      />
    ),
  },
  { kind: "figure", node: <Figure art={<MethodFigure />} caption="Method at a glance: Revision A is compared with the later revision, and the difference goes to a decision." /> },
  { kind: "h2", text: "Build a revision register" },
  { kind: "list", items: [
    "Product, hardware applicability, firmware or software version, effective date and owner.",
    "Source digest, exact text or image region, correction and supersession relationship.",
    "Dependencies: the instruction, related troubleshooting steps and existing answers.",
    "Reviewer and approval outcome, with rejected candidates and their reasons preserved.",
  ] },
  { kind: "h2", text: "Run the comparison" },
  { kind: "p", text: "Pick two public or approved revisions and extract the changed rule from each independently. Ask one question for the prior equipment and one for the current equipment, and mark the source region, date and applicability of each answer. The assistant should refuse or flag incomplete evidence and leave compatibility uninvented. A qualified reviewer approves anything that touches safety." },
  { kind: "h2", text: "What to measure in a pilot" },
  { kind: "p", text: "Capture source-match accuracy, correct revision selection, missing context, support time and repeated questions against a fixed test set, then judge which changes proved useful. Report productivity figures once real data has been collected." },
  { kind: "h2", text: "Separate publication, effective and observed time" },
  { kind: "p", text: "A document's upload date and the date its instructions became valid are two facts. An organization may adopt a procedure in September, publish an amendment in October and upload it to a shared folder in November. A useful knowledge record keeps those dates apart. When the historical availability is unknown, return that uncertainty and leave the file's modification time out of the answer." },
  { kind: "h2", text: "Read a real revision history" },
  { kind: "p", text: "On August 27, 2025, NIST announced minor release 5.2.0 of SP 800-53. The changes concern secure software updates and patches, among other controls. The announcement and the official change summary, both listed under Sources, are distinct documents. Keep the earlier and the later control text side by side, and link each affected statement to the edition it cites." },
  { kind: "h3", text: "Revision review" },
  { kind: "list", items: [
    "Original source becomes a preserved revision.",
    "New revision becomes a typed difference.",
    "Affected claims are marked stale, changed or unchanged.",
    "Owner review produces a new approved snapshot.",
  ] },
  { kind: "h2", text: "Build an impact report" },
  { kind: "p", text: "Suppose a procurement checklist cites a control that changes. First resolve the exact control identifier and source revision. Then identify only the documents and claims that depend on it. Present the old and new source spans, explain whether the difference affects applicability, and assign unresolved items to an owner. Replacing every reference automatically can destroy historical context, so keep the prior accepted snapshot reproducible and clearly separate from current guidance." },
  { kind: "h2", text: "Verify reproducibility" },
  { kind: "p", text: "Ask the same question against a snapshot from before the release and against the current snapshot, and check the citation and revision on both answers. Re-run the compilation after an unrelated source changes and compare the identifiers and digests of the unaffected records. These checks show whether the system tracks change or returns the newest paragraph." },
  { kind: "h2", text: "Check the sources" },
  { kind: "p", text: "Confirm the applicable source version and its licence before reuse. The examples describe a method, and results depend on the actual source and configuration." },
  {
    kind: "figure",
    node: (
      <ReadNext
        label="Read next"
        links={[
          { href: v34Route("changes").path, label: "Compare what changed" },
          { href: v34Route("evidence").path, label: "Evidence behind an answer" },
          { href: v34Route("engineering").path, label: "Engineering references" },
          { href: v34Route("journal").path, label: "All field guides" },
        ]}
      />
    ),
  },
];

/** The article and its closing strip, without the V34 frame, so it can be rendered on its own. */
export function RevisionBody({ published, modified }: { published: string; modified: string }) {
  return (
    <>
      <ArticleLayout
        title={record.heading}
        dek={REVISION_DEK}
        published={published}
        modified={modified}
        breadcrumb={[{ href: v34Route("home").path, label: "Home" }, { href: v34Route("journal").path, label: v34Route("journal").ogLabel }]}
        cover={<Figure art={<RevisionCover />} caption="An earlier and a later revision of a source lead to the approved revision." />}
        blocks={REVISION_BLOCKS}
        sources={REVISION_SOURCES}
      />
      <FinalCta
        title="The manual changed. Did the answer?"
        cta={{ href: v34Route("changes").path, label: "See what changed between versions" }}
        secondary={{ href: v34Route("journal").path, label: "All field guides →" }}
      />
    </>
  );
}

/** The page body, inside the V34 frame. */
export default function RevisionArticle() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <RevisionBody {...articleDates(ROUTE)} />
    </V34Page>
  );
}
