import Link from "next/link";
import {
  EXPLORE_SAMPLE_DIGEST,
  exploreSampleArtifact,
  exploreSampleSnapshots,
  exploreSampleSources,
  exploreSampleWorld,
} from "@/lib/explore-sample";

/*
  T1 product proof: every number and locator comes from the frozen public Apple corpus that
  powers /explore. This is deliberately HTML and CSS instead of a generic illustration so the
  visual can remain source-bound, selectable and legible without motion or WebGL.
*/
export default function SolutionProofSample() {
  const pageCount = exploreSampleSources.reduce((total, source) => total + source.pageCount, 0);
  const regionCount = exploreSampleWorld.evidence.length;
  const objectCount = exploreSampleArtifact.validation.counts.candidatesConsidered
    ?? exploreSampleWorld.objects.length;
  const evidence = exploreSampleWorld.evidence[0];
  if (!evidence) return null;

  const [left, top, right, bottom] = evidence.bbox;
  const source = exploreSampleSources.find((entry) => entry.documentId === evidence.sourceId);

  return (
    <figure className="solution-proof-sample" aria-labelledby="solution-proof-sample-title">
      <figcaption className="solution-proof-sample-head">
        <span id="solution-proof-sample-title">PUBLIC COMPILED WORLD · APPLE SEC CORPUS</span>
        <Link href="/explore">Inspect the evidence</Link>
      </figcaption>
      <div className="solution-proof-sample-grid">
        <section className="solution-proof-source" aria-label={`${exploreSampleSources.length} filings, ${pageCount} pages`}>
          <span className="solution-proof-label">SOURCE SET</span>
          <div className="solution-proof-documents" aria-hidden="true">
            {exploreSampleSources.map((item) => (
              <i key={item.documentId} style={{ height: `${42 + (item.pageCount / 103) * 44}px` }} />
            ))}
          </div>
          <strong>{exploreSampleSources.length} filings</strong>
          <small>{pageCount.toLocaleString("en-US")} pages</small>
        </section>

        <section className="solution-proof-region" aria-label={`${regionCount} exact evidence regions`}>
          <span className="solution-proof-label">EXACT EVIDENCE</span>
          <div className="solution-proof-page" aria-hidden="true">
            <i style={{
              left: `${left / 10}%`,
              top: `${top / 10}%`,
              width: `${(right - left) / 10}%`,
              height: `${(bottom - top) / 10}%`,
            }} />
          </div>
          <strong>{regionCount.toLocaleString("en-US")} regions</strong>
          <small>{source?.form ?? "Filing"} · page {evidence.page}</small>
        </section>

        <section className="solution-proof-objects" aria-label={`${objectCount} compiled object candidates`}>
          <span className="solution-proof-label">COMPILED OBJECTS</span>
          <div className="solution-proof-object-map" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
          </div>
          <strong>{objectCount.toLocaleString("en-US")} objects</strong>
          <small>identity · claims · relations</small>
        </section>

        <section className="solution-proof-world" aria-label={`${exploreSampleSnapshots.length} versioned World snapshots`}>
          <span className="solution-proof-label">VERSIONED WORLD</span>
          <div className="solution-proof-timeline" aria-hidden="true">
            {exploreSampleSnapshots.map((snapshot, index) => (
              <i key={snapshot.id} data-active={index === exploreSampleSnapshots.length - 1 ? "true" : "false"} />
            ))}
          </div>
          <strong>W0 → W4</strong>
          <small>{EXPLORE_SAMPLE_DIGEST.slice(0, 18)}…</small>
        </section>
      </div>
    </figure>
  );
}
