import type { Metadata, Route } from "next";
import KnowledgeCompilerDiagram from "@/components/knowledge-compiler-diagram";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "What Is a Knowledge Compiler? — TAVONEL", description: "A practical guide to Knowledge Compilers, RAG, knowledge graphs and enterprise search.", alternates: { canonical: "/knowledge-compiler" }, openGraph: { url: "/knowledge-compiler" } };

/*
  The category guide.

  Masterplan 13.11 keeps this page for what it already does well -- naming the category and
  distinguishing it from RAG, graphs and search -- and asks for five things it did not have: a
  visual comparison, when to use one, when not to, a glossary, a FAQ, the package contract and a
  way onward. It also asks for one deletion, the "CATEGORY DEFINITION - NOT A PERFORMANCE CLAIM"
  badge, which answered an accusation nobody reading a category guide had made.

  The section that took the most care is "When it is not the right tool". A category page that
  cannot say where its category stops is an advertisement, and every case listed there is one
  this product genuinely does not serve -- not a straw man chosen because the answer is flattering.
*/

/*
  BA-020. Ten identical rows become eight, with an index over them and the reference behind a
  disclosure.

  Measured on this branch before the change: 4,796px at 1280 and 7,284px at 390 -- about nine
  phone screens -- as ten heading-left/table-right rows with no anchor on any of them, nothing to
  skip with, and no call to action until the last. Three changes, none of which deletes a
  sentence:

    - the three "Compared with" sections become one section of three rows. They were three rows
      of the same shape, each ending in a COMPILER row saying the compiler is the larger thing,
      so the page made that argument three times and a reader took it once.
    - `index` puts the section list under the hero, and every section now has an id to point at.
    - the reference sections -- when it is not the right tool, the glossary, the questions --
      are `collapsed`. They are what a reader consults rather than what they read, and together
      they were about half the page's height.

  The primary action moves up to the compile contract, the section that either convinces a reader
  or does not. It was at the very bottom, six screens later.
*/
export default function KnowledgeCompilerPage() {
  return <PublicProofRegistry index eyebrow="CATEGORY GUIDE" title="What is a Knowledge Compiler?" summary="A Knowledge Compiler turns changing source material into a versioned, evidence-bound, portable knowledge object that people and AI systems can inspect together." sections={[
    { title: "The compile contract", body: "The unit of value is not a chat response. It is a Compiled World with immutable inputs, structured objects, exact evidence, review state, retrieval material and portable files.", links: [
      { href: "/explore", label: "OPEN A COMPILED WORLD" },
      { href: "/login", label: "START WITH YOUR FILES" },
    ], rows: [
      { key: "INPUT", description: "Versioned source files and connector cursors.", state: "IMMUTABLE" },
      { key: "STRUCTURE", description: "Directory, ontology, entities, claims and relations.", state: "REVIEWABLE" },
      { key: "EVIDENCE", description: "Source version, the exact location inside it, excerpt and digest.", state: "TRACEABLE" },
      { key: "WORLD", description: "Candidate and active revisions separated by a human decision.", state: "VERSIONED" },
    ] },
    {
      title: "Where each category acts",
      body: "These are not four competing products. They are four different spans of one pipeline, which is why the comparisons below are about scope rather than quality.",
      figure: <KnowledgeCompilerDiagram />,
    },
    { title: "Compared with RAG, graphs and search", body: "RAG retrieves chunks at question time, a graph stores entities and relations, and enterprise search helps people find documents. A Knowledge Compiler produces all three — retrieval units, a graph, a document index — and treats each as one projection of a reviewed World rather than as the final asset. Build-time structure, evidence and versions that several retrieval or model layers can consume, in other words, and the rows below are about that scope rather than about quality.", rows: [
      { key: "RAG", description: "Question-time retrieval over an index; quality depends on chunking, retrieval and generation. The units a compiler emits come out of a reviewed World, so each one carries the region it was read from and changes only when the World does.", state: "COMPLEMENTARY" },
      { key: "KNOWLEDGE GRAPH", description: "A representation of connected objects. A compiler adds the source pipeline, evidence contract, review lifecycle, retrieval projections and portable package around that graph — the process and the receipts that make the representation inspectable and maintainable.", state: "COMPONENT" },
      { key: "ENTERPRISE SEARCH", description: "Find and rank relevant source material. A compiler materializes reusable claims, objects and evidence paths for both people and agents, and preserves the links back to those documents rather than discarding provenance.", state: "DOCUMENT-CENTRIC" },
    ] },
    { title: "When a compiler is the right tool", body: "Compiling costs a reading pass and a review. It pays for itself where the same material is answered from repeatedly, where being wrong is expensive, and where somebody will eventually ask how an answer was reached.", rows: [
      { key: "REPEATED USE", description: "The same corpus answers many questions, for many people, over months.", state: "PAYS BACK" },
      { key: "CONSEQUENCE", description: "A wrong answer costs a return visit, a rework order, a filing or a claim.", state: "WORTH PROVING" },
      { key: "SCRUTINY", description: "Somebody will ask which page an answer came from, and a plausible sentence is not an acceptable reply.", state: "NEEDS EVIDENCE" },
      { key: "CHANGE", description: "Sources are revised, superseded and amended, and last quarter's answer still has to be explainable.", state: "NEEDS VERSIONS" },
    ] },
    { title: "When it is not the right tool", collapsed: true, body: "A category page that cannot say where its category stops is an advertisement. These are cases this product does not serve, and saying so here is cheaper for everyone than finding out after a pilot.", rows: [
      { key: "ONE DOCUMENT", description: "A single file you will read once. Open it. The compile buys nothing you do not already have.", state: "USE A READER" },
      { key: "LIVE RECORDS", description: "Answers that are a query over a database or a ticket queue, not a claim written in a document.", state: "QUERY THE SYSTEM" },
      { key: "NO REVIEWER", description: "Nobody who can decide whether a candidate World is correct. Promotion is a human decision by design, and without one the World never becomes active.", state: "NEEDS A PERSON" },
      { key: "BEYOND THE SOURCES", description: "Questions whose answer is not in the material. Retrieval here is a matching test, not a judgement about whether what matched answers you: it declines only when nothing matched at all, so a question the corpus cannot answer comes back as the nearest matching regions with their locators rather than as a refusal. Deciding they do not answer it is the reader\u2019s work, and buying a compiler to do that work is the wrong purchase.", state: "OUT OF SCOPE" },
    ] },
    { title: "Glossary", collapsed: true, body: "The words this product uses in the exact sense it uses them. Where a term has a looser industry meaning, the narrower one here is deliberate.", rows: [
      { key: "COMPILED WORLD", description: "The output of one compile: objects, relations, evidence, retrieval material and a validation report, addressed by a digest.", state: "THE ARTIFACT" },
      { key: "CANDIDATE", description: "A compiled result that has not been promoted. It can be read, downloaded and reviewed; nothing answers from it.", state: "LIFECYCLE" },
      { key: "ACTIVE", description: "The one revision a workspace answers from. It changes only when a person promotes a candidate or rolls back to a prior revision.", state: "LIFECYCLE" },
      { key: "EVIDENCE REGION", description: "A source version, an exact location inside it, an excerpt and a digest. What a citation resolves to. The location takes whatever form the source has; in a PDF it is a page and a box measured in thousandths of it.", state: "PROVENANCE" },
      { key: "STABLE ID", description: "An identifier derived from content, so recompiling the same source lands on the same object rather than a new one.", state: "IDENTITY" },
      { key: "MANIFEST DIGEST", description: "The sha256 of the canonical form of a World. Two Worlds with the same digest are the same World.", state: "IDENTITY" },
      { key: "ABSTENTION", description: "The answer given when the sources do not support one. It is a result, not a failure.", state: "BEHAVIOUR" },
      { key: "PACKAGE", description: "The portable form: canonical model, Turtle, JSON-LD, CSV, retrieval JSONL, provenance and a validation report.", state: "PORTABILITY" },
    ] },
    { title: "Questions people ask", collapsed: true, body: "Short answers about what the product does today, not what a category could do in principle.", faq: [
      {
        question: "Is this just RAG with extra steps?",
        answer: "RAG is a retrieval strategy; this is an artifact. The chunks a retriever needs are one file in the package, produced from a reviewed World rather than from raw text — so they carry the page and region they came from, and they change only when the World does.",
      },
      {
        question: "Do I have to replace my retrieval stack?",
        answer: "No. The package ships the graph as Turtle, JSON-LD and CSV, and the retrieval units as JSONL, so an existing vector store, graph database or agent framework loads them without adopting anything else.",
      },
      {
        question: "What happens when a source document changes?",
        answer: "The new bytes are a new version, and compiling produces a new candidate rather than editing the World in place. The active revision moves only when a person promotes it, and the previous revision stays readable so an older answer remains explainable.",
      },
      {
        question: "What does it do when it does not know?",
        answer: "It declines when nothing in the World matched the question at all, and says which sources it looked at. What it does not do is decide whether what matched actually answers you \u2014 that judgement stays with the reader, which is why every answer carries the page and the region it came from. A composed answer with no region behind it would be indistinguishable from a correct one, and that is the failure this whole contract exists to prevent.",
      },
      {
        question: "What stops the output from being a black box?",
        answer: "Every object carries the regions that support it, the package is a set of open formats, and the validator that checks a package is a readable script rather than a service — so a package can be verified without asking us anything.",
      },
    ] },
    {
      title: "The package is the contract",
      body: "Portability is only real if someone outside can check it. The package format, its required files and the two verifiers — one for the archive's signature, one for what is inside it — are documented, and a compiled sample is open without an account.",
      /*
        E-21. The category guide is the page a reader arrives on from a search for the category,
        and it was a dead end for the two questions it provokes -- "how is a fact actually bound
        to a source" and "has any of this been measured" -- because it linked to the package
        format and the sign-in and to neither of the pages that answer them. Both existed;
        /benchmarks became crawlable in the Category Leadership campaign and nothing pointed at it
        from here. `lib/trust-page-answers.test.ts` holds the two links in place.
      */
      /*
        BA-019. Six chips of equal weight are a link list in button clothing, and with no primary
        among them the page ended without asking for anything. One primary, one secondary, and
        the four references as the reading list they already were.

        BA-016 is the third of those references. It read "WHAT WOULD BE MEASURED", sitting between
        two labels that describe things that exist, and announced an absence in the one place a
        reader decides whether to go further. /benchmarks publishes the protocol -- what a
        knowledge-compilation result has to carry before it may be published as a number -- so the
        door says that, and the page behind it still says plainly that it has no table yet.
      */
      links: [
        { href: "/explore", label: "OPEN A COMPILED WORLD" },
        { href: "/login", label: "START WITH YOUR FILES" },
      ],
      readNext: [
        { href: "/evidence", label: "How evidence is bound" },
        { href: "/benchmarks", label: "How results are measured" },
        // `/docs/[section]` is a dynamic route, so a literal section needs the cast typedRoutes asks for.
        { href: "/docs/exports" as Route, label: "Package format" },
        { href: "/docs/cli" as Route, label: "Verifiers" },
      ],
    },
  ]} />;
}
