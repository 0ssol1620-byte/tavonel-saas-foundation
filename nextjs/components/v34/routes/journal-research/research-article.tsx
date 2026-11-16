import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ArticleLayout, type ArticleBlock } from "@/components/v34/ui/article-layout";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { v34Route } from "@/lib/v34/routes";
import { articleDates } from "../journal/article-dates";
import { ResearchCover } from "../journal/covers";
import { ReadNext } from "../journal/read-next";
import { MethodFigure } from "./figures";
import { RESEARCH_SOURCES } from "./research-sources";

/*
  An evidence register for a literature review. The one outside fact is the published study of
  chatbot-generated references, cited by its DOI; every other sentence describes a method.
*/

const ROUTE = "journal-research";
const record = v34Route(ROUTE);

export const RESEARCH_DEK = "Trace a claim to the exact method, result and limitation, then keep the record reproducible.";

export const RESEARCH_BLOCKS: readonly ArticleBlock[] = [
  { kind: "h2", text: "Begin with the claim and read the summary after" },
  { kind: "p", text: "A paper may report a finding under a specific population, instrument, method or level of uncertainty. A summary can compress those conditions away. A citation link helps a reader find the paper, and the reader still has to check that the quoted conclusion matches what was studied." },
  {
    kind: "figure",
    node: (
      <ScrollTable
        label="The fields of an evidence register"
        caption="One register entry per claim."
        columns={["Field", "What it holds"]}
        rows={[
          ["Claim", "The exact proposition under review, with observation and interpretation kept apart."],
          ["Evidence", "The permitted passage, table or figure and its anchor, with the source DOI or version when available."],
          ["Method", "What was measured and how, including the comparison and the assumptions."],
          ["Limitations", "Uncertainty, conflicting or missing findings, publication status and date."],
          ["Review", "Reviewer, inclusion or exclusion reason, version history and the next check."],
        ]}
      />
    ),
  },
  { kind: "h2", text: "Compare competing claims" },
  { kind: "p", text: "Select two publicly available records on one research topic. Define the question and the inclusion criteria before reading the outcomes. Extract each claim with its scope, method and limitations independently, then decide whether the studies disagree or answer different questions. Review the exact evidence behind each, and treat a synthesized assertion as a pointer to it." },
  { kind: "figure", node: <Figure art={<MethodFigure />} caption="Method at a glance: a claim is checked against its method and bounded by its limitation." /> },
  { kind: "h2", text: "Keep the review alive" },
  { kind: "p", text: "When a correction, a preprint revision or a new study appears, link it to the original, retain its date and re-evaluate the affected assertions. A living register supports collaboration and evidence checks, and the earlier entries stay readable as they were." },
  { kind: "h2", text: "Bound the claim" },
  { kind: "p", text: "This workflow organizes and traces evidence. A formal review adds its own screening, quality appraisal, protocol and independent review, and published material is used within the rights its owner grants." },
  { kind: "h2", text: "Anchor a conclusion in an inspectable record" },
  { kind: "p", text: "A polished paragraph and a convincing bibliography are weak evidence on their own. A generated reference may be wrong, and an authentic citation may fail to support the specific claim. Create a record for the publication identifier, edition, relevant page or table, extracted statement, study context and limitations. Keep a paper's conclusion, a later interpretation and a new hypothesis as three separate entries." },
  { kind: "h3", text: "Evidence review" },
  { kind: "list", items: [
    "Discovery: record identifiers and inclusion criteria.",
    "Extraction: capture the exact relevant source spans.",
    "Assessment: distinguish design, population and limitations.",
    "Synthesis: connect each claim to eligible evidence.",
    "Reproduction: retain the reviewed snapshot and the method.",
  ] },
  { kind: "h2", text: "Handle contradictory research" },
  { kind: "p", text: "Two studies can legitimately disagree because their populations, interventions, instruments or outcome definitions differ. Represent the scope of each result and leave the model's score out of the verdict. Create a comparison record that links both source spans and describes the known differences. Flag unresolved contradictions, and keep causal statements within the study design." },
  { kind: "h2", text: "Make citation verification a separate test" },
  { kind: "p", text: "A published study of chatbot-generated references reported fabricated references and errors in real citations; it is listed under Sources. Its findings concern the systems and conditions it studied. A practical evaluation checks that the identifier exists, that the bibliographic details match and that each citation supports the statement it is attached to. Report those three dimensions separately and include questions that have no eligible source." },
  { kind: "h2", text: "Publish the method with the result" },
  { kind: "p", text: "Record the search date, repositories used, query, inclusion rules, excluded sources and review decisions. Retain accessible evidence links where licences permit, and use bibliographic metadata and authorized access when redistribution is restricted. A reproducible evidence record can then take in a new study and leave the historical review as it was." },
  {
    kind: "figure",
    node: (
      <ReadNext
        label="Read next"
        links={[
          { href: v34Route("evidence").path, label: "Evidence behind an answer" },
          { href: v34Route("research").path, label: "Research with sources" },
          { href: v34Route("world").path, label: "A public reference World" },
          { href: v34Route("journal").path, label: "All field guides" },
        ]}
      />
    ),
  },
];

/** The article and its closing strip, without the V34 frame, so it can be rendered on its own. */
export function ResearchBody({ published, modified }: { published: string; modified: string }) {
  return (
    <>
      <ArticleLayout
        title={record.title.replace(/ — TAVONEL$/, "")}
        dek={RESEARCH_DEK}
        published={published}
        modified={modified}
        breadcrumb={[{ href: v34Route("home").path, label: "Home" }, { href: v34Route("journal").path, label: v34Route("journal").ogLabel }]}
        cover={<Figure art={<ResearchCover />} caption="Method, source and result overlap in one research record." />}
        blocks={RESEARCH_BLOCKS}
        sources={RESEARCH_SOURCES}
      />
      <FinalCta
        title="A citation is a pointer to the evidence."
        cta={{ href: v34Route("evidence").path, label: "Inspect the evidence" }}
        secondary={{ href: v34Route("journal").path, label: "All field guides →" }}
      />
    </>
  );
}

/** The page body, inside the V34 frame. */
export default function ResearchArticle() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <ResearchBody {...articleDates(ROUTE)} />
    </V34Page>
  );
}
