import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ArticleLayout, type ArticleBlock } from "@/components/v34/ui/article-layout";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { v34Route } from "@/lib/v34/routes";
import { articleDates } from "../journal/article-dates";
import { ReadNext } from "../journal/read-next";
import { Cover, MethodFigure } from "./figures";
import { PROPERTY_SOURCES } from "./property-sources";

/*
  A dated evidence register for property research. A preview article: it describes a method and
  names one public aggregate series. It states no valuation, no parcel fact and no professional opinion.
*/

const ROUTE = "journal-property";
const record = v34Route(ROUTE);

export const PROPERTY_DEK = "Build a diligence record that keeps factual sources, missing records and dates separate.";

export const PROPERTY_BLOCKS: readonly ArticleBlock[] = [
  { kind: "h2", text: "Separate a listing from a verified record" },
  { kind: "p", text: "A listing communicates the seller's description. Legal boundaries, permitted use, infrastructure, actual transaction prices and environmental risk come from other records, issued by different authorities on different dates. A diligence record surfaces the disagreements and the missing records and keeps each one visible, in place of a single blended rating." },
  { kind: "p", text: "Deeds, surveys and inspection reports each become a record of their own: the statement, the source document, its date and the page it came from." },
  { kind: "figure", node: <Figure art={<MethodFigure />} caption="Method at a glance: a parcel leads to its record, and the record goes to review." /> },
  { kind: "h2", text: "Start with a source matrix" },
  {
    kind: "figure",
    node: (
      <ScrollTable
        label="Property questions, the authority that can answer each and the limit of its answer"
        columns={["Question", "Candidate authority", "Limitation"]}
        rows={[
          ["What is the parcel?", "Official land or parcel record", "Identifier and jurisdiction required."],
          ["What use is permitted?", "Local planning or zoning authority", "Verify current conditions and overlays."],
          ["What is being built nearby?", "Permit authorities; aggregate official statistics", "An aggregate series describes an area, and a parcel needs its own record."],
          ["What is the asking price?", "Listing or licensed data", "An asking price states a position; a sale or a value needs its own record."],
          ["What remains unknown?", "Inspection, title, qualified professional", "Track absent records explicitly."],
        ]}
      />
    ),
  },
  { kind: "h2", text: "Prepare before comparing" },
  { kind: "list", items: [
    "Resolve the parcel and the jurisdiction, and treat an address as a pointer to them.",
    "Save the date, source identifier, licensing and the exact excerpt or permitted aggregate.",
    "Mark contradictory records, missing coverage, date mismatches and professional review needs.",
    "Compare options with the same questions and sources, and keep facts apart from scenarios.",
  ] },
  { kind: "p", text: "This is a general research workflow. Appraisal, title opinion, legal advice and brokerage belong to qualified local specialists working from current official records." },
  { kind: "h2", text: "Identify the asset before making a judgment" },
  { kind: "p", text: "A parcel, a building, a lease and a planning application are four different things, and their identifiers and boundaries can change over time. Start by recording the parcel number, the jurisdiction and the date of each source, and separate the descriptions a seller supplies from official records. On a site with several parcels, document which assertion applies to which parcel. A planning policy for a nearby lot says little about whether the subject site can be developed." },
  { kind: "h2", text: "Make the decision packet auditable" },
  { kind: "h3", text: "Due diligence evidence register" },
  { kind: "list", items: [
    "Title and ownership: the competent registry or a licensed adviser.",
    "Planning and use: the governing local authority and the applicable date.",
    "Physical constraints: survey, utilities, access and condition.",
    "Comparable evidence: transaction terms, date and geographic scope.",
    "Open issues: required expert sign-off and missing documents.",
  ] },
  { kind: "p", text: "For US market context, the Census Building Permits Survey methodology, listed under Sources, describes the permit-issuing jurisdictions. It is a useful aggregated supply signal and sits one level above a parcel-level planning approval. Coverage, imputation and changing jurisdictions all matter when comparing areas. For an individual parcel, consult the actual local planning and property records, and keep the aggregated survey and the local records distinct." },
  { kind: "h2", text: "Track what remains uncertain" },
  { kind: "p", text: "For each question, write an asserted status, the source, the date, any conflicting evidence and the next verification action. A missing route-of-access document and evidence that legal access is absent are different findings, and the record should show both along with who owns the next action. An inspection report describes the structure it inspected and speaks for that structure alone." },
  { kind: "p", text: "Preserve the decision packet as it stood at the date of the investment committee review. If a planning application changes, create an impact report that shows what changed and leave the past version as it was. A property evidence workflow supports professional diligence, and local legal, surveying and planning advice remains with the professionals." },
  { kind: "h2", text: "Check the sources" },
  { kind: "p", text: "Confirm the applicable source version and its licence before reuse. The examples describe a method, and results depend on the actual source and configuration." },
  {
    kind: "figure",
    node: (
      <ReadNext
        label="Read next"
        links={[
          { href: v34Route("evidence").path, label: "Evidence behind an answer" },
          { href: v34Route("changes").path, label: "Compare what changed" },
          { href: v34Route("world").path, label: "A public reference World" },
          { href: v34Route("journal").path, label: "All field guides" },
        ]}
      />
    ),
  },
];

/** The article and its closing strip, without the V34 frame, so it can be rendered on its own. */
export function PropertyBody({ published, modified }: { published: string; modified: string }) {
  return (
    <>
      <ArticleLayout
        title={record.heading}
        dek={PROPERTY_DEK}
        published={published}
        modified={modified}
        breadcrumb={[{ href: v34Route("home").path, label: "Home" }, { href: v34Route("journal").path, label: v34Route("journal").ogLabel }]}
        cover={<Figure art={<Cover />} caption="One parcel is described by dated records, and each record is reviewed." />}
        blocks={PROPERTY_BLOCKS}
        sources={PROPERTY_SOURCES}
      />
      <FinalCta
        title="A property is more than its listing."
        cta={{ href: v34Route("evidence").path, label: "Inspect the evidence" }}
        secondary={{ href: v34Route("journal").path, label: "All field guides →" }}
      />
    </>
  );
}

/** The page body, inside the V34 frame. */
export default function PropertyArticle() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <PropertyBody {...articleDates(ROUTE)} />
    </V34Page>
  );
}
