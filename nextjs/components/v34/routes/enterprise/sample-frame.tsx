import Link from "next/link";
import { SAMPLE_FRAME_LABEL } from "@/components/sample-world-frame";
import { Tag } from "@/components/v34/ui/tag";
import { sourceRectStyle } from "@/lib/source-page-geometry";
import type { SignedProductDemo } from "@/lib/signed-product-demo";
import { RETAINED, retained } from "./enterprise-content";
import s from "./sample-frame.module.css";

const shortDigest = (value: string) => `${value.slice(0, 16)}…${value.slice(-8)}`;

/*
  The public sample, rendered. Everything on it is read from `lib/signed-product-demo.ts`, which
  compiles the repository's own synthetic PDFs: the cited excerpt, the page it came from and the
  evidence region at the coordinates the compile request carries. The label sits inside the
  bordered frame so a crop or a screenshot cannot part the two. No page content is drawn, because
  none is known here; the rectangle is the cited geometry and nothing else, and it is not drawn at
  all when the citation has none.
*/
export function SampleFrame({ demo }: { demo: SignedProductDemo }) {
  const { citation } = demo.answer;
  const region = citation.bbox1000 === null ? null : sourceRectStyle(citation.bbox1000);
  const cited = demo.fixture.sources.find((source) => source.documentId === citation.sourceId);
  if (!cited) throw new Error("enterprise_sample_cited_source_missing");

  return (
    <figure className={s.frame} aria-labelledby="enterprise-sample-caption">
      <div className={s.art}>
        <b className={s.label}>{SAMPLE_FRAME_LABEL}</b>
        <div className={s.grid}>
          <div className={s.pageWrap}>
            <div className={s.page} role="img" aria-label={`Evidence region on page ${citation.pageNumber1} of ${cited.label}`}>
              {region === null ? null : <span className={s.region} style={region} />}
            </div>
            <p className={s.pageNo}>page {citation.pageNumber1}</p>
          </div>
          <div className={s.read}>
            <p className={s.question}>{demo.answer.question}</p>
            <blockquote className={s.excerpt}>{citation.excerpt}</blockquote>
            <dl className={s.meta}>
              <div className={s.metaRow}>
                <dt className={s.metaName}>Source</dt>
                <dd className={s.metaValue}>{cited.label}</dd>
              </div>
              <div className={s.metaRow}>
                <dt className={s.metaName}>Evidence</dt>
                <dd className={s.metaValue}><code className={s.code}>{citation.evidenceId}</code></dd>
              </div>
              <div className={s.metaRow}>
                <dt className={s.metaName}>Active World</dt>
                <dd className={s.metaValue}>revision {demo.activation.revision} · <code className={s.code}>{shortDigest(demo.activation.manifestDigest)}</code></dd>
              </div>
              <div className={s.metaRow}>
                <dt className={s.metaName}>Activated by</dt>
                <dd className={s.metaValue}>a person, on {demo.activation.activatedAt.slice(0, 10)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
      <figcaption id="enterprise-sample-caption" className={s.caption}>
        <Tag kind="Sample" />
        <p className={s.captionText}>
          The same answer{" "}
          <Link className={s.link} href={retained(RETAINED.demo)} prefetch={false}>the signed sample path</Link>{" "}
          produces, from repository-owned synthetic PDFs about a fictional appliance. The interval
          moved from {demo.change.from} to {demo.change.to} in a change notice; the answer returns
          the region of the revision that carries it. Deployment evidence for a qualified review is
          produced against your own agreed scope.
        </p>
      </figcaption>
    </figure>
  );
}
