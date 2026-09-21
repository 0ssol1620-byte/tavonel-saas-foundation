import Link from "next/link";
import type { Route } from "next";
import { sourceRectStyle } from "@/lib/source-page-geometry";
import type { SignedProductDemo } from "@/lib/signed-product-demo";

/*
  The public sample, rendered, with its label inside the frame.

  Gap #15 of the 2026-09-22 competitor visual audit. `/enterprise` carried the words
  "PUBLIC SAMPLE · SYNTHETIC DATA" above four prose cards and no sample: the page a security
  buyer arrives on referred to a demonstration it did not show. Every competitor in that audit
  puts a real artifact on the page; this one named one.

  Three things it deliberately is not.

  It is not a screenshot. There is no page image for the FP-200 fixture, and drawing one would be
  an illustration of a product rather than the product -- the rule AGENTS.md states and the reason
  `structara-webgl-scene.tsx` is gone. What is drawn is the real answer `lib/signed-product-demo.ts`
  produces at build time from the repository's own synthetic PDFs: the cited excerpt, the page it
  came from, and the evidence region at the coordinates the compile request actually carries.

  It is not a table. The capability manifest says `no_table_or_formula_extraction`, so the region
  proxy draws one rectangle on a blank page outline and never a cell grid, a row rule or a column
  boundary. An icon may not look more capable than the manifest row behind it (§7.2 of the audit).

  And the label does not sit above the frame where a crop or a screenshot would lose it. It is
  inside the border, in the corner of the artifact itself, because the failure mode this guards
  against is a synthetic sample travelling into a deck as if it were a customer's. The fixture is
  four repository-owned PDFs about a fictional fryer; no customer material reaches this page, and
  `lib/trust-provisions.test.ts` fails if the label leaves the frame.
*/

const shortDigest = (value: string) => `${value.slice(0, 16)}…${value.slice(-8)}`;

export const SAMPLE_FRAME_LABEL = "PUBLIC SAMPLE · SYNTHETIC DATA";

export default function SampleWorldFrame({ demo }: { demo: SignedProductDemo }) {
  const { citation } = demo.answer;
  const region = citation.bbox1000 === null ? null : sourceRectStyle(citation.bbox1000);
  /* The cited source, found by the id the citation carries rather than by its position. */
  const cited = demo.fixture.sources.find((source) => source.documentId === citation.sourceId);
  if (!cited) throw new Error("sample_world_frame_cited_source_missing");

  return (
    <figure className="sample-frame" aria-labelledby="sample-frame-title">
      <div className="sample-frame-art">
        {/* Inside the border, over the artifact, so a crop cannot separate the two. */}
        <b className="sample-frame-label">{SAMPLE_FRAME_LABEL}</b>

        <div className="sample-frame-grid">
          {/*
            The page proxy: an outline at the fixture page's proportions with the evidence region
            at its real coordinates. No page content is drawn, because none is known here -- the
            rectangle is the geometry the compile request carries and nothing else.
          */}
          <div className="sample-frame-page" role="img" aria-label={`Evidence region on page ${citation.pageNumber1} of ${cited.label}`}>
            {region === null ? null : <span className="sample-frame-region" style={region} />}
            <i>page {citation.pageNumber1}</i>
          </div>

          <div className="sample-frame-read">
            <p className="sample-frame-q">{demo.answer.question}</p>
            <blockquote className="sample-frame-excerpt">{citation.excerpt}</blockquote>
            <dl className="sample-frame-meta">
              <div>
                <dt>Source</dt>
                <dd>{cited.label}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd><code>{citation.evidenceId}</code></dd>
              </div>
              <div>
                <dt>Active world</dt>
                <dd>revision {demo.activation.revision} · <code>{shortDigest(demo.activation.manifestDigest)}</code></dd>
              </div>
              <div>
                <dt>Activated by</dt>
                <dd>a person, on {demo.activation.activatedAt.slice(0, 10)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <figcaption id="sample-frame-title" className="fine">
        The same answer <Link href={"/demo" as Route}>the signed sample path</Link> produces, from
        four repository-owned synthetic PDFs about a fictional appliance. The interval moved from{" "}
        {demo.change.from} to {demo.change.to} in a change notice; the answer returns the region of
        the revision that carries it. Deployment evidence for a qualified review is produced
        against your own agreed scope, not from this fixture.
      </figcaption>
    </figure>
  );
}
