import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import PolicyJumpIndex, { IndexedPolicyBody } from "@/components/policy-jump-index";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustDisclosures } from "@/components/trust-disclosures";
import TrustProvisions from "@/components/trust-provisions";

export const metadata: Metadata = {
  alternates: { canonical: "/trust" },
  openGraph: { url: "/trust" },
  title: "Trust Center — TAVONEL",
  description:
    "Public policies, processors, legal terms, and security contacts for evaluating how TAVONEL handles documents.",
};

const DPA_URL = "/policy/TAVONEL_DPA_v1_2026-09-11.md";
const DPA_LABEL =
  "Draft v1 (2026-09-11) — under review; not a signed agreement";

const DESTINATIONS: Array<[string, string, Route]> = [
  ["Security", "The customer-facing safeguards for document intake, workspace access, evidence, activation, retention, and deletion.", "/security" as Route],
  ["Privacy notice", "What is collected, why it is processed, where it is stored, which processing happens outside Korea, and how to ask for access, export or deletion.", "/privacy" as Route],
  ["Subprocessors", "Every third-party service permitted to process account, document, billing or inquiry data, with the purpose and the data class for each one.", "/subprocessors" as Route],
  ["Service status", "Public availability and incident notices for the service.", "/status" as Route],
  ["Terms", "The agreement itself.", "/terms" as Route],
  ["Security contact", "security@tavonel.com for a vulnerability, privacy@tavonel.com for a data request, and the inquiry form for a security review.", "/contact" as Route],
];

export default function TrustCenterPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body policy-copy"><IndexedPolicyBody>
            <div className="stack">
              {/*
                BA-150 put the page's subject in the heading, which is what a procurement reader
                scanning for it is looking for. BA-176 was about the `<br/>` that fused
                "publishabout" in the accessible name; BQ-097 removed the break entirely.

                BQ-112. "Everything we publish" opened on a completeness claim and then spent the
                page qualifying it -- including a section called "What is not published yet". A
                heading that has to be withdrawn three screens later is not a heading, and
                completeness was never the page's argument: its job is to be the one address
                where the handling answers are, which is what it says now.
              */}
              <h1 className="document-title">What we publish about handling your documents.</h1>
              {/* G2-040 / G2-041: one jump index for long documents, from the shared component. */}
              <PolicyJumpIndex />
            </div>
            <div className="stack">
              {/*
                BA-164 and BA-150. Two things were wrong with this sentence and both were counting.

                "The same thirteen things every time" states a universal thirteen-item security
                review that does not exist -- the thirteen is §45's internal list, so the sentence
                asserted an unverifiable fact as given and leaked the shape of an internal spec.
                And building the lede out of "twelve... one... two more" made the reader do
                arithmetic to find out what is published, with the bold weight landing on the two
                absences.

                So the count is gone from the copy, and what remains is checkable against the page
                itself: the rows below, and the two that are named as unpublished. The absences are
                still here, in the same paragraph, unbolded and after what is provided.
                `lib/trust-page-answers.test.ts` holds this page and /pricing to the same two
                absences instead of to a shared number.
              */}
              <p className="lede">
                Start with the maintained public policies, processor record, legal terms, and
                reporting contacts below. Deployment-specific architecture, control evidence,
                assurance scope, and questionnaire responses are provided through a qualified
                review. The published data processing agreement remains clearly labelled as a draft.
              </p>
              {/*
                B04. Five hubs -- this one, Evidence, Benchmarks, Reproducibility, Research --
                answer five different questions, and were reachable from one another with nothing
                saying which was which, so a reader looking for one of the five read parts of
                three. Each now opens with the same shaped line: what this page answers, and which
                page answers the next thing.
              */}
              <p className="fine">
                <b>This page answers one question:</b> what is published about security and
                document handling, and where to request a qualified review. How a citation stays bound to its source is
                on <Link href={"/evidence" as Route}>Evidence</Link>; what a result has to carry
                before it is published as a number is on <Link href={"/benchmarks" as Route}>Benchmarks</Link>;
                the frozen fixtures you can rerun are on <Link href={"/reproducibility" as Route}>Reproducibility</Link>;
                the open problems and the experiments that failed are on <Link href={"/research" as Route}>Research</Link>.
              </p>

              {/*
                BA-072, from the copy-sources-trustcase lane. CROSS-LANE -> copy-commerce-legal:
                this paragraph is the one edit that lane's /trust needs, and it is two lines.

                The same sentence -- ending on "no customer has given it" -- was printed on
                /benchmarks, /evidence and /reproducibility, so three pages volunteered to a
                reader who had not asked, and to no legal requirement, that we have no customers;
                /reproducibility ended its hero paragraph on it. Removing it from three pages and
                adding it nowhere would lose a policy worth publishing, so it lives here once,
                written as the policy it is, with no count of who has met it.

                `trust-page-answers.test.ts` holds it to this one home in both directions: it
                fails if this paragraph goes, and it fails if any of the three gets it back.
              */}
              <p className="fine">
                Customer names, figures and logos appear on this site only with that
                customer&rsquo;s written sign-off on the exact wording.
              </p>

              {/*
                The whole tile is the link, not the heading inside it.

                `a { color: inherit; text-decoration: none }` is global here, so a link wrapped
                around a heading in a tile renders as prose -- on an index whose entire job is to
                be seven destinations, that is the defect. Making the tile the anchor also gives a
                phone a target the size of the card rather than the size of two words.
              */}
              <h2>The pages</h2>
              <div className="tiles">
                {DESTINATIONS.map(([title, body, href]) => (
                  <Link className="tile trust-link" key={title} href={href}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </Link>
                ))}
                <a className="tile trust-link" key="security.txt" href="/.well-known/security.txt">
                  <h3>security.txt</h3>
                  <p>The machine-readable disclosure record: reporting address, policy and preferred languages, at the well-known path.</p>
                </a>
                {/*
                  A plain anchor, not a `Link`: the DPA is a served file rather than a route, so
                  typed routing does not apply and a client-side navigation would be wrong.

                  The label travels with the link everywhere it appears, which is the whole
                  discipline of publishing an unsigned document: a reader who sees the URL without
                  the label has been handed a contract, and a reader who sees both has been handed
                  a draft. `lib/trust-page-answers.test.ts` fails if the two are ever separated.
                */}
                <a className="tile trust-link" key="dpa" href={DPA_URL}>
                  <h3>Data processing agreement</h3>
                  <p>{DPA_LABEL}. It states the breach-notification and sub-processor change commitments, the verified-request deletion right, and the qualifications that apply to legal retention duties and provider backups. The clauses still open say so in place.</p>
                </a>
              </div>

              <TrustDisclosures />

              {/*
                Gap #6, 2026-09-22. The disclosure list above says where a record is published;
                it does not say what a reviewer gets. The table does, in three states, from
                `content/trust/provisions.ts` -- the same rows /security and /enterprise render.
              */}
              <TrustProvisions id="trust-provisions" />

              {/*
                BA-173. The first sentence answered an accusation nobody made ("nothing here is a
                summary of a document you cannot read") in 11px mono at the foot of the page, which
                is the tone `public-copy-purge.test.ts` exists to remove. What is left is the
                maintenance rule, which is a fact a reviewer can use.
              */}
              <p className="fine">
                Each row points at the page that makes the statement, and that page is where the
                wording is maintained.
              </p>

              <div className="actions">
                <Link className="btn" href={"/security" as Route}>Start with the data path</Link>
                <Link className="btn ghost" href={"/contact" as Route}>Ask a security review question</Link>
              </div>
            </div>
          </IndexedPolicyBody></div>
        </div>
      </section>
    </PublicSitePage>
  );
}
