import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { clause } from "@/lib/compiler-contract";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/compiled-world" },
  openGraph: { url: "/product/compiled-world" },
  title: "Compiled World — TAVONEL",
  description:
    "The output of a TAVONEL compile: objects, relations, evidence and versions, portable as one signed package.",
};

/*
  A product page lists what the product does.

  The fifth card here was "DIRECTION — Automated ontology", describing a capability the page
  then said is "not a shipped capability", closing with a footnote reading "Knowledge
  architecture is labelled Direction in this deployment. Live capability is fail-closed; see
  /status." A prospect came away with four things the product does and one it does not, with no
  reason to weight them differently. Work that is not built belongs on the research page, where
  it is the subject rather than an asterisk on a sales page.
*/
/*
  The identity and relation cards are written against the Compiler Contract's own clause states.

  Audit M02 and M03. This page said "the same thing named in two documents is one thing in the
  world" and "what supports, supersedes, depends on or contradicts what" in the present tense,
  one click from `lib/compiler-contract.ts`, which marks cross-string identity merge `direction`
  and names the edges the compiler actually emits. Two pages on the same site disagreeing about
  the same compiler is worse than either sentence alone, so the two cards are written against
  their clause, import it, and link to it. The day a clause changes state the check below stops
  the build, and `product-claims-sync.test.ts` requires the sentence to be re-derived rather than
  left standing.
*/
const IDENTITY = clause("stable-semantic-identity");
const RELATIONS = clause("typed-dependencies");

/*
  BA-013. The tie to the registry is a build error now, not a readiness ladder in the card.

  Two of the six cards ended with the state word and its definition printed in mono -- "DIRECTION
  An intended property of the compiler contract. Not offered as a shipped capability in this
  deployment." and "DEMONSTRATED Built and shown on a declared sample or controlled path; not a
  production qualification." A prospect read a card and was then told by us that what they had
  just read does not qualify. That vocabulary belongs on /product/continuous-knowledge, where all
  eight clauses are the subject and a reader arrives for exactly that distinction; the card keeps
  its pointer to the clause, without the grade.

  What the printed label bought was drift protection: change a clause's state and the card's word
  changed with it. This buys more. The two cards are written against these two states, so a flip
  now stops the build and names the cards to re-derive, instead of swapping an adjective under
  copy that has quietly become false. `product-claims-sync.test.ts` pins this in place of the
  label it used to pin, and the identity card's "are not merged automatically" sentence is still
  required by the assertion beside it.
*/
if (IDENTITY.state !== "direction" || RELATIONS.state !== "demonstrated") {
  throw new Error(
    "a compiler-contract clause changed state: re-derive the OBJECTS and RELATIONS cards on /product/compiled-world",
  );
}

type Part = {
  state: string;
  title: string;
  body: string;
  /** The contract clause this card is derived from, pointed at rather than graded. */
  clause?: typeof IDENTITY;
};

/*
  A product page lists what the product does.

  The fifth card here was "DIRECTION — Automated ontology", describing a capability the page
  then said is "not a shipped capability", closing with a footnote reading "Knowledge
  architecture is labelled Direction in this deployment. Live capability is fail-closed; see
  /status." A prospect came away with four things the product does and one it does not, with no
  reason to weight them differently. Work that is not built belongs on the research page, where
  it is the subject rather than an asterisk on a sales page.
*/
const PARTS: readonly Part[] = [
  {
    state: "OBJECTS",
    title: "The things themselves",
    body: "Entities, claims and the documents they were read from get a stable key derived from their content, so recompiling the same source lands on the same object instead of a new one. Two different strings for one real-world thing — FP-200 and Feedwater Pump 200 — are not merged automatically: where the evidence does not settle identity the compiler leaves it unresolved for a person rather than guessing, and automatic resolution across sources is a direction.",
    clause: IDENTITY,
  },
  {
    state: "RELATIONS",
    title: "What connects to what",
    /*
      The live engine's set, read from the Core's own semantics.py after audit R3-K09 stopped the
      projection discarding two thirds of it: `mentions` runs from a claim to an entity matched
      in that claim's sentence, and `contradicts` is a candidate a person resolves, never a
      resolution.

      BA-015. Three sentences, and the implementation stays in the documentation.

      This card was a 130-word dump: it named the predicate set, explained a case-folded match
      over capitalised phrases, acronyms and Korean organisation names, described a
      capitalised-token scan and a keyword rule set, told the reader the public Explore sample
      runs a different engine, and closed on "are still directions: the gate in front of
      retrieval does not check them". Every one of those facts is still published, in the place
      that maintains it: the per-predicate table with its engine column is
      /docs/ontology-output, which this page's own actions row links to; the business-relation
      limit is the typed-dependencies clause this card points at; and the sample's engine is
      labelled where its figures are, on Explore. What the card keeps is the contract a buyer is
      reading it for -- typed, evidence-bearing edges, and a contradiction that goes to a person.
    */
    body: "Every edge is typed and carries the evidence ids that justify it — an edge naming no evidence is not a row the compiler can produce. A claim is supported_by the one exact document version it was read from, and mentions the entities named inside it. Two claims that disagree on a number, or on whether something is the case, inside one topic and one time reference are emitted as a contradicts candidate and sent to review: the compiler flags the pair and a person resolves it.",
    clause: RELATIONS,
  },
  /*
    RESOLVED A-1 (2026-09-06), applied here in the repair pass rather than in the pass that
    changed the other eight surfaces. This row published the PDF locator -- "a document version,
    page and region" -- as the general shape of all evidence, which is the wording A-1 retires.
    A cell in a spreadsheet and a MIME part in an email are exact locations with no page. The
    per-source forms are set out once, on /evidence, rather than repeated here.
  */
  {
    state: "EVIDENCE",
    title: "Where a fact came from",
    body: "Every qualified claim points at a source version and its exact location inside it. A world holding an unresolved link is not emitted at all.",
  },
  {
    state: "VERSIONS",
    title: "What changed, and when",
    body: "A compile produces a candidate version. A person activates it, and the version it replaced stays intact and readable.",
  },
  /*
    "One world, read by Ask, search, the API and MCP" was the old third sentence here. The package
    does carry all five projections; which of them a live answer is served from depends on whether
    that World carries a compiled retrieval run, and the answer reports the path it took. Stating
    the artifact and pointing at the per-answer report is the half of that sentence this page can
    keep.
  */
  {
    state: "PROJECTIONS",
    title: "How it is consumed",
    body: "Ontology, graph, retrieval corpus, directory and validation artifacts, written into one package from one world. Every Ask answer names the retrieval path that produced it, so which projection an answer came from is reported rather than assumed.",
  },
  {
    state: "PACKAGE",
    title: "What you can take",
    body: "A signed package, hash-verified on the way out. The public key is published at /api/export/trust, so a recipient can verify it without asking us.",
  },
];

export default function CompiledWorldPage() {
  return (
    <PublicSitePage>
      <BreadcrumbJsonLd trail={[{ name: "Product", path: "/product" }, { name: "Compiled World", path: "/product/compiled-world" }]} />
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              {/*
                BA-026. The trail the page already declares to a crawler, now on the screen.

                `BreadcrumbJsonLd` above emits Product -> Compiled World for search engines, and
                a reader arriving on this page from that same search had no visible way back to
                /product except the navigation's disclosure menu.
              */}
              <p className="doc-breadcrumb"><Link href={"/product" as Route}>Product</Link> <span aria-hidden="true">/</span> Compiled World</p>
              <p className="slate"><b>PRODUCT</b><span />COMPILED WORLD</p>
              {/*
                BA-024. The headline spent its first two words on what the product is not, and
                repeated the home page's contrast instead of advancing it. Six cards under it
                make the case; the headline states the claim.
              */}
              <h1 className="document-title">A world your AI can reason about.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                The output of a compile is a Compiled World: objects, relations, evidence,
                versions and the artifacts that project them.
                <b> One world, used by retrieval, agents, MCP, APIs and applications.</b>
              </p>
              <div className="tiles">
                {PARTS.map((part) => (
                  <article className="tile" key={part.title}>
                    <span className="n">{part.state}</span>
                    {/*
                      BA-025. h2, not h3: these cards are the first sections under the h1, so an
                      h3 here left the page's heading outline h1 -> h3 and a screen-reader user
                      could not walk it. `.tiles .tile h2` in tavonel.css already carries the
                      card treatment, so the visual weight is unchanged.
                    */}
                    <h2>{part.title}</h2>
                    <p>{part.body}</p>
                    {part.clause ? (
                      <p className="fine">
                        <Link href={`/product/continuous-knowledge#${part.clause.id}` as Route}>
                          {part.clause.name} in the Compiler Contract
                        </Link>
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
              {/*
                BA-019. Five buttons in a row are a link list wearing buttons, and at phone width
                they stacked left-aligned at five different widths. One primary, one secondary,
                and the three references become links in the closing sentence -- which is also
                where a reader who has finished the six cards is looking.
              */}
              <p className="fine">
                Every compile emits the same package shape, so a world built today can be read by
                a tool written against one built last month. The formats are set out in{" "}
                <Link href="/docs/ontology-output">the ontology output</Link>, how a fact is bound
                to its source in <Link href="/evidence">Evidence</Link>, and how to consume a
                world from an assistant in{" "}
                <Link href="/docs/use-with-ai">Use the result with AI</Link>.
              </p>
              <div className="actions">
                <Link className="btn" href={"/explore" as Route}>Explore a Compiled World</Link>
                <Link className="btn ghost" href="/developers">Read it from your code</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
