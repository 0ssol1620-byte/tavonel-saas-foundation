import type { Route } from "next";
import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ArticleLayout, type ArticleBlock } from "@/components/v34/ui/article-layout";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { v34Route } from "@/lib/v34/routes";
import { articleDates } from "../journal/article-dates";
import { CompilerCover } from "../journal/covers";
import { ReadNext } from "../journal/read-next";
import { COMPILER_SOURCES } from "./compiler-sources";
import { ProofLine } from "./proof-line";

/*
  What is a Knowledge Compiler: the body of the category guide, folded into an article. Every
  statement is one the guide already made public, kept in its own words where it had them. The
  sources are external references; the guide's earlier citation of this site's own front page is gone.
*/

const ROUTE = "journal-compiler";
const record = v34Route(ROUTE);
/** A retained page that is not in the registry: the guard test checks that its page file exists. */
const retained = (path: string) => path as Route;

export const COMPILER_DEK = "A search index finds passages. A Knowledge Compiler makes their identity, evidence, relationships and changes inspectable.";

const QUESTIONS: readonly (readonly [string, string])[] = [
  ["Is this just RAG with extra steps?", "RAG is a retrieval strategy. A Compiled World is an artifact. The chunks a retriever needs are one file in the package, produced from a reviewed World rather than from raw text, so they carry the page and region they came from and change only when the World does."],
  ["Do I have to replace my retrieval stack?", "Your existing stack keeps working. The package ships the graph as Turtle, JSON-LD and CSV, and the retrieval units as JSONL, so a vector store, graph database or agent framework loads them without adopting anything else."],
  ["What happens when a source document changes?", "The new bytes are a new version, and compiling produces a new candidate rather than editing the World in place. The active revision moves only when a person activates it, and the previous revision stays readable so an older answer remains explainable."],
  ["What does it do when the sources have no answer?", "It declines when nothing in the World matched the question at all, and says which sources it looked at. Whether what matched answers the question stays with the reader, which is why every answer carries the page and the region it came from. A composed answer without a region behind it would look the same as a correct one, and that is the failure this contract exists to prevent."],
  ["What stops the output from being a black box?", "Every object carries the regions that support it, the package is a set of open formats, and the validator that checks a package is a readable script rather than a service, so a package can be verified without asking us anything."],
];

const TERMS: readonly (readonly [string, string])[] = [
  ["Compiled World", "The output of one compile: objects, relations, evidence, retrieval material and a validation report, addressed by a digest."],
  ["Candidate", "A compiled result awaiting activation. It can be read, downloaded and reviewed, and nothing answers from it until a person activates it."],
  ["Active", "The one revision a workspace answers from. It changes when a person activates a candidate or rolls back to a prior revision."],
  ["Evidence region", "A source version, an exact location inside it, an excerpt and a digest. A citation resolves to one. In a PDF the location is a page and a box measured in thousandths of it."],
  ["Stable ID", "An identifier derived from content, so recompiling the same source lands on the same object."],
  ["Manifest digest", "The sha256 of the canonical form of a World. Two Worlds with the same digest are the same World."],
  ["Abstention", "The answer given when the sources support none. It is a result in its own right."],
  ["Package", "The portable form: canonical model, Turtle, JSON-LD, CSV, retrieval JSONL, provenance and a validation report."],
];

const COMPARISON: readonly (readonly [string, string, string])[] = [
  ["RAG", "Question-time retrieval over an index. Quality depends on chunking, retrieval and generation.", "The units a compiler emits come out of a reviewed World, so each one carries the region it was read from and changes only when the World does."],
  ["Knowledge graph", "A representation of connected objects.", "The source pipeline, evidence contract, review lifecycle, retrieval projections and portable package around that graph: the process and the receipts that make it inspectable and maintainable."],
  ["Enterprise search", "Finds and ranks relevant source material.", "Reusable claims, objects and evidence paths for people and agents, with the links back to the documents kept."],
];

export const COMPILER_BLOCKS: readonly ArticleBlock[] = [
  { kind: "h2", text: "Start with the question your AI needs to answer" },
  { kind: "p", text: "Imagine two revisions of a technical manual. Search can return a highly relevant passage from either one, and relevance alone leaves open whether that instruction was current on the date you care about or whether a later revision replaced it. A Knowledge Compiler works on that gap. It builds a record that shows what an answer was built from, instead of asking a model to sound more confident." },
  { kind: "figure", node: <Figure art={<ProofLine />} caption="The compile contract: each step keeps a link to the one before it." /> },
  { kind: "h2", text: "What a compile produces" },
  { kind: "p", text: "The unit of value is a Compiled World, and a chat response is one way to read it. One compile turns versioned source files into structured objects, exact evidence, review state, retrieval material and portable files." },
  { kind: "list", items: [
    "Input: versioned source files and connector cursors, kept as they arrived.",
    "Structure: a directory, an ontology, entities, claims and relations, open to review.",
    "Evidence: the source version, the exact location inside it, an excerpt and a digest.",
    "World: a candidate revision and an active revision, separated by a human decision.",
  ] },
  { kind: "h2", text: "Compared with RAG, graphs and search" },
  { kind: "p", text: "RAG retrieves chunks at question time, a graph stores entities and relations, and enterprise search helps people find documents. A Knowledge Compiler produces all three kinds of output (retrieval units, a graph and a document index) and treats each as one projection of a reviewed World rather than as the final asset. The comparison is about scope: these are spans of one pipeline." },
  { kind: "figure", node: <ScrollTable label="A Knowledge Compiler compared with RAG, graphs and enterprise search" columns={["Approach", "What it does", "What a compiler adds"]} rows={COMPARISON} /> },
  { kind: "h2", text: "A practical evaluation" },
  { kind: "p", text: "A fair comparison holds the corpus, the model, the access policy, the query and the date constant, then measures exact source support, stale claims, abstentions, latency and cost." },
  { kind: "list", items: [
    "Choose two rights-cleared versions of a small document and record their digests.",
    "Write questions whose answers change between the versions, and questions whose answers stay the same.",
    "Ask both systems the same questions with the same date and permissions, and mark the source region and revision each answer used.",
    "Record unsupported claims, missed changes, cost and the exact evidence used, failures included.",
  ] },
  { kind: "h2", text: "When a compiler is the right tool" },
  { kind: "p", text: "Compiling costs a reading pass and a review. It pays for itself where the same material is answered from repeatedly, where a wrong answer is expensive, and where somebody will eventually ask how an answer was reached." },
  { kind: "list", items: [
    "Repeated use: the same corpus answers many questions, for many people, over months.",
    "Consequence: a wrong answer costs a return visit, a rework order, a filing or a claim.",
    "Scrutiny: somebody will ask which page an answer came from, and a plausible sentence is a poor reply.",
    "Change: sources are revised, superseded and amended, and last quarter's answer still has to be explainable.",
  ] },
  { kind: "h2", text: "When another tool is enough" },
  { kind: "p", text: "A single stable document and a simple lookup are served well by a reader or a conventional search. A compile adds value as relationships, change history, reproducibility or repeated use across agents start to matter." },
  { kind: "list", items: [
    "One document: a single file you will read once. Open it in a reader.",
    "Live records: answers that come from a query over a database or a ticket queue rather than from a claim written in a document.",
    "Review capacity: activation is a human decision, so a World needs a person who can judge whether a candidate is correct.",
    "Questions beyond the sources: they return the nearest matching regions with their locators, and judging whether those regions answer the question stays with the reader.",
  ] },
  { kind: "h2", text: "Terms used in this guide" },
  { kind: "list", items: TERMS.map(([term, meaning]) => `${term}: ${meaning}`) },
  { kind: "h2", text: "Questions people ask" },
  ...QUESTIONS.flatMap(([question, answer]): ArticleBlock[] => [{ kind: "h3", text: question }, { kind: "p", text: answer }]),
  { kind: "h2", text: "The package is the contract" },
  { kind: "p", text: "Portability is only real if someone outside can check it. The package format, its required files and the two verifiers, one for the archive's signature and one for what is inside it, are documented, and a compiled sample is open without an account." },
  {
    kind: "figure",
    node: (
      <ReadNext
        label="Read next"
        links={[
          { href: v34Route("evidence").path, label: "How evidence is bound" },
          { href: retained("/benchmarks"), label: "How results are measured" },
          { href: retained("/docs/exports"), label: "Package format" },
          { href: retained("/docs/cli"), label: "Verifiers" },
        ]}
      />
    ),
  },
];

/** The article and its closing strip, without the V34 frame, so it can be rendered on its own. */
export function CompilerBody({ published, modified }: { published: string; modified: string }) {
  return (
    <>
      <ArticleLayout
        title={record.heading}
        dek={COMPILER_DEK}
        published={published}
        modified={modified}
        breadcrumb={[{ href: v34Route("home").path, label: "Home" }, { href: v34Route("journal").path, label: v34Route("journal").ogLabel }]}
        cover={<Figure art={<CompilerCover />} caption="Originals pass through a compile step and become a World of linked records." />}
        blocks={COMPILER_BLOCKS}
        sources={COMPILER_SOURCES}
      />
      <FinalCta
        title="Continue learning."
        cta={{ href: v34Route("compiler").path, label: "Inspect the compiler" }}
        secondary={{ href: v34Route("journal").path, label: "All field guides →" }}
      />
    </>
  );
}

/** The page body, inside the V34 frame. */
export default function CompilerArticle() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <CompilerBody {...articleDates(ROUTE)} />
    </V34Page>
  );
}
