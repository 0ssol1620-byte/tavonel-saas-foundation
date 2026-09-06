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

export default function KnowledgeCompilerPage() {
  return <PublicProofRegistry eyebrow="CATEGORY GUIDE" title="What is a Knowledge Compiler?" summary="A Knowledge Compiler turns changing source material into a versioned, evidence-bound, portable knowledge object that people and AI systems can inspect together." sections={[
    { title: "The compile contract", body: "The unit of value is not a chat response. It is a Compiled World with immutable inputs, structured objects, exact evidence, review state, retrieval material and portable files.", rows: [
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
    { title: "Compared with RAG", body: "RAG retrieves chunks at question time. A Knowledge Compiler can produce retrieval units too, but treats them as one projection of a reviewed World rather than the final asset.", rows: [
      { key: "RAG", description: "Question-time retrieval over an index; quality depends on chunking, retrieval and generation.", state: "COMPLEMENTARY" },
      { key: "COMPILER", description: "Build-time structure, evidence and versions that multiple retrieval or model layers can consume.", state: "PERSISTENT ASSET" },
    ] },
    { title: "Compared with a knowledge graph", body: "A graph stores entities and relations. A Knowledge Compiler adds the source pipeline, evidence contract, review lifecycle, retrieval projections and portable package around that graph.", rows: [
      { key: "GRAPH", description: "A representation of connected objects.", state: "COMPONENT" },
      { key: "COMPILER", description: "The process and receipts that make the representation inspectable and maintainable.", state: "SYSTEM" },
    ] },
    { title: "Compared with enterprise search", body: "Enterprise search helps people find documents. A Knowledge Compiler materializes reusable claims, objects and evidence paths for both people and agents, while preserving links back to those documents.", rows: [
      { key: "SEARCH", description: "Find and rank relevant source material.", state: "DOCUMENT-CENTRIC" },
      { key: "COMPILER", description: "Build a versioned knowledge layer without discarding source provenance.", state: "WORLD-CENTRIC" },
    ] },
    { title: "When a compiler is the right tool", body: "Compiling costs a reading pass and a review. It pays for itself where the same material is answered from repeatedly, where being wrong is expensive, and where somebody will eventually ask how an answer was reached.", rows: [
      { key: "REPEATED USE", description: "The same corpus answers many questions, for many people, over months.", state: "PAYS BACK" },
      { key: "CONSEQUENCE", description: "A wrong answer costs a return visit, a rework order, a filing or a claim.", state: "WORTH PROVING" },
      { key: "SCRUTINY", description: "Somebody will ask which page an answer came from, and a plausible sentence is not an acceptable reply.", state: "NEEDS EVIDENCE" },
      { key: "CHANGE", description: "Sources are revised, superseded and amended, and last quarter's answer still has to be explainable.", state: "NEEDS VERSIONS" },
    ] },
    { title: "When it is not the right tool", body: "A category page that cannot say where its category stops is an advertisement. These are cases this product does not serve, and saying so here is cheaper for everyone than finding out after a pilot.", rows: [
      { key: "ONE DOCUMENT", description: "A single file you will read once. Open it. The compile buys nothing you do not already have.", state: "USE A READER" },
      { key: "LIVE RECORDS", description: "Answers that are a query over a database or a ticket queue, not a claim written in a document.", state: "QUERY THE SYSTEM" },
      { key: "NO REVIEWER", description: "Nobody who can decide whether a candidate World is correct. Promotion is a human decision by design, and without one the World never becomes active.", state: "NEEDS A PERSON" },
      { key: "BEYOND THE SOURCES", description: "Questions whose answer is not in the material. The World abstains rather than composing one, which is the right behaviour and the wrong tool for that job.", state: "OUT OF SCOPE" },
    ] },
    { title: "Glossary", body: "The words this product uses in the exact sense it uses them. Where a term has a looser industry meaning, the narrower one here is deliberate.", rows: [
      { key: "COMPILED WORLD", description: "The output of one compile: objects, relations, evidence, retrieval material and a validation report, addressed by a digest.", state: "THE ARTIFACT" },
      { key: "CANDIDATE", description: "A compiled result that has not been promoted. It can be read, downloaded and reviewed; nothing answers from it.", state: "LIFECYCLE" },
      { key: "ACTIVE", description: "The one revision a workspace answers from. It changes only when a person promotes a candidate or rolls back to a prior revision.", state: "LIFECYCLE" },
      { key: "EVIDENCE REGION", description: "A source version, an exact location inside it, an excerpt and a digest. What a citation resolves to. The location takes whatever form the source has; in a PDF it is a page and a box measured in thousandths of it.", state: "PROVENANCE" },
      { key: "STABLE ID", description: "An identifier derived from content, so recompiling the same source lands on the same object rather than a new one.", state: "IDENTITY" },
      { key: "MANIFEST DIGEST", description: "The sha256 of the canonical form of a World. Two Worlds with the same digest are the same World.", state: "IDENTITY" },
      { key: "ABSTENTION", description: "The answer given when the sources do not support one. It is a result, not a failure.", state: "BEHAVIOUR" },
      { key: "PACKAGE", description: "The portable form: canonical model, Turtle, JSON-LD, CSV, retrieval JSONL, provenance and a validation report.", state: "PORTABILITY" },
    ] },
    { title: "Questions people ask", body: "Short answers about what the product does today, not what a category could do in principle.", faq: [
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
        answer: "It abstains and says which sources it looked at. A composed answer with no region behind it would be indistinguishable from a correct one, which is the failure this whole contract exists to prevent.",
      },
      {
        question: "What stops the output from being a black box?",
        answer: "Every object carries the regions that support it, the package is a set of open formats, and the validator that checks a package is a readable script rather than a service — so a package can be verified without asking us anything.",
      },
    ] },
    {
      title: "The package is the contract",
      body: "Portability is only real if someone outside can check it. The package format, its required files and the two verifiers — one for the archive's signature, one for what is inside it — are documented, and a compiled sample is open without an account.",
      links: [
        { href: "/explore", label: "OPEN A COMPILED WORLD" },
        // `/docs/[section]` is a dynamic route, so a literal section needs the cast typedRoutes asks for.
        { href: "/docs/exports" as Route, label: "PACKAGE FORMAT" },
        { href: "/docs/cli" as Route, label: "VERIFIERS" },
        { href: "/login", label: "START WITH YOUR FILES" },
      ],
    },
  ]} />;
}
