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
import { MARKETS_SOURCES } from "./markets-sources";

/*
  Point-in-time research, as a checklist. A preview article: it describes a method for keeping
  hindsight out of an analysis and names the public archives that record availability dates. The
  example record is a placeholder with no market data, and the page makes no investment statement.
*/

const ROUTE = "journal-markets";
const record = v34Route(ROUTE);

export const MARKETS_DEK = "A point-in-time evidence checklist for financial research: what was knowable on the date of a decision.";

export const MARKETS_BLOCKS: readonly ArticleBlock[] = [
  { kind: "h2", text: "Separate the information date from the decision date" },
  { kind: "p", text: "A document can describe an earlier period and become public much later. A revised macroeconomic release can also change historical numbers. When an analysis asks what was knowable before an event, today's revised dataset brings later information into the past." },
  { kind: "h2", text: "Four dates to preserve" },
  {
    kind: "figure",
    node: (
      <ScrollTable
        label="The four dates a point-in-time record keeps and why each matters"
        columns={["Date", "Why it matters"]}
        rows={[
          ["Effective or observation time", "The period the fact describes."],
          ["Published or available time", "When it became knowable."],
          ["Ingested or recorded time", "When the system obtained that specific revision."],
          ["Decision cutoff", "Keeps later releases out of an as-of query."],
        ]}
      />
    ),
  },
  { kind: "p", text: "For each datum, preserve the source, identifier, publication or ingestion timestamp, original version and rights. Say what available means for the analysis at hand: a public release, a subscription delivery or a timestamp the system captured. Where availability is missing, record the uncertainty and leave the date uninferred." },
  { kind: "figure", node: <Figure art={<MethodFigure />} caption="Method at a glance: a release comes before the cutoff, and later data stays outside the question." /> },
  { kind: "h2", text: "Test with a filing" },
  { kind: "p", text: "Choose two SEC filings with known filing timestamps and freeze the cutoff before the later one. Retrieve the earlier supporting passage and confirm that the later release is excluded. Repeat after the cutoff and inspect the affected claims. A corrected claim sits beside the historical record and leaves it standing." },
  { kind: "h2", text: "What did you know at the decision date?" },
  { kind: "p", text: "Financial research can look rigorous while using information that had yet to be released. Macroeconomic series are revised, corporate filings can be amended, and publication times differ from the fiscal period they report. A result built on the latest data everywhere can make an in-sample simulation look better than it was. The answer is to record availability, version and source in the data itself, because a warning beside a chart leaves the data unchanged." },
  { kind: "h2", text: "Use the original sources" },
  { kind: "p", text: "The St. Louis Fed's ALFRED service archives vintages, and its real-time period documentation explains how to request the information available over a historical date range. The SEC's EDGAR interfaces expose filing histories and extracted XBRL facts. Preserve the accession number, filing timestamp, period and units, and treat the latest company fact as today's value and a separate fact from the historical observation. Both are listed under Sources." },
  {
    kind: "figure",
    node: (
      <Figure
        kind="Sample"
        framed={false}
        caption="An illustrative historical decision record. It carries months and no market data."
        art={
          <ScrollTable
            label="An illustrative historical decision record"
            columns={["Step", "Record"]}
            rows={[
              ["Observation period", "January"],
              ["Initial release", "February, first value"],
              ["Revision", "April, second value"],
              ["March decision", "Use the first value, because the April revision is yet to be published."],
            ]}
          />
        }
      />
    ),
  },
  { kind: "h2", text: "Audit a research workflow" },
  { kind: "p", text: "Set the as-of date before searching, then retrieve only the observations whose release and access assumptions satisfy it. If a release timestamp is missing, label the limitation and keep that observation out of a precise intraday decision. Keep a manifest of series identifiers, filing accessions, transformation versions and source hashes. A later refresh creates a different snapshot, and the old experiment stays as it ran." },
  { kind: "p", text: "When comparing strategies, hold the universe, the transaction-cost assumptions and the decision timing identical, and test survivorship and future-data leakage separately. A stronger evidence workflow gives an analyst a way to investigate a result and reproduce its inputs. The method is research infrastructure, and each investment decision stays with the analyst." },
  { kind: "h2", text: "Limits" },
  { kind: "p", text: "Feed licensing, timestamps, survivorship and execution assumptions each need their own validation. Treat this article as a method for managing evidence." },
  {
    kind: "figure",
    node: (
      <ReadNext
        label="Read next"
        links={[
          { href: v34Route("markets").path, label: "Market filings as a compiled sample" },
          { href: v34Route("evidence").path, label: "Evidence behind an answer" },
          { href: v34Route("changes").path, label: "Compare what changed" },
          { href: v34Route("journal").path, label: "All field guides" },
        ]}
      />
    ),
  },
];

/** The article and its closing strip, without the V34 frame, so it can be rendered on its own. */
export function MarketsBody({ published, modified }: { published: string; modified: string }) {
  return (
    <>
      <ArticleLayout
        title={record.title.replace(/ — TAVONEL$/, "")}
        dek={MARKETS_DEK}
        published={published}
        modified={modified}
        breadcrumb={[{ href: v34Route("home").path, label: "Home" }, { href: v34Route("journal").path, label: v34Route("journal").ogLabel }]}
        cover={<Figure art={<Cover />} caption="A cutoff date separates the releases a question may use from the later ones." />}
        blocks={MARKETS_BLOCKS}
        sources={MARKETS_SOURCES}
      />
      <FinalCta
        title="What was knowable at the decision date?"
        cta={{ href: v34Route("markets").path, label: "See the compiled filings sample" }}
        secondary={{ href: v34Route("journal").path, label: "All field guides →" }}
      />
    </>
  );
}

/** The page body, inside the V34 frame. */
export default function MarketsArticle() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <MarketsBody {...articleDates(ROUTE)} />
    </V34Page>
  );
}
