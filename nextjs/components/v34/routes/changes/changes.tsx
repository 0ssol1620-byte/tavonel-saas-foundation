import Link from "next/link";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { exploreChangeTimeline } from "@/lib/explore-change";
import { readPublicCorpus } from "@/lib/v34/public-corpus";
import { v34Route } from "@/lib/v34/routes";
import { ChangesArt } from "./changes-art";
import {
  ACTIVATE, BRIDGE, COVERS, FINAL, HERO, REVISION, REVISION_RECORD_ID, REVISION_RELATION,
  REVISION_SOURCE_IDS, TIMELINE,
} from "./changes-content";
import s from "./changes.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const count = (value: number) => value.toLocaleString("en-US");
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shortDigest = (digest: string) => `${digest.replace(/^sha256:/, "sha256 ").slice(0, 20)}…`;

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function ChangesBody() {
  const corpus = readPublicCorpus();
  const byId = new Map(corpus.nodes.map((node) => [node.id, node] as const));
  const revision = byId.get(REVISION_RECORD_ID);
  const announcement = revision ? corpus.sources[revision.source] : undefined;
  if (!revision || !announcement) throw new Error("changes: the revision record is missing from the corpus");
  const touched = corpus.edges
    .filter((edge) => edge.a === REVISION_RECORD_ID && edge.relation === REVISION_RELATION)
    .map((edge) => {
      const node = byId.get(edge.b);
      if (!node) throw new Error(`changes: corpus record ${edge.b} is missing`);
      return node;
    });
  const sources = REVISION_SOURCE_IDS.map((id) => {
    const source = corpus.sources[id];
    if (!source) throw new Error(`changes: corpus source ${id} is missing`);
    return source;
  });

  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={v34Route("changes").heading}
        lead={HERO.lead}
        actions={<ButtonLink href={HERO.primary.href}>{HERO.primary.label}</ButtonLink>}
        art={<Figure art={<ChangesArt label={HERO.art.label} />} caption={HERO.art.caption} />}
      />

      <Section surface="green" title={REVISION.title} lead={REVISION.lead}>
        <div className={s.tagRow}>
          <Tag kind="Public reference corpus" />
        </div>
        <ol className={s.path}>
          <li className={s.pathItem}>
            <p className={s.when}>Before {announcement[1]}</p>
            <h3 className={s.itemTitle}>{REVISION.steps.before.title}</h3>
            <p className={s.itemText}>{REVISION.steps.before.text}</p>
          </li>
          <li className={s.pathItem}>
            <p className={s.when}>{announcement[1]}</p>
            <h3 className={s.itemTitle}>{revision.label}</h3>
            <p className={s.itemText}>{revision.note}</p>
          </li>
          <li className={s.pathItem}>
            <p className={s.when}>After review</p>
            <h3 className={s.itemTitle}>{REVISION.steps.after.title}</h3>
            <p className={s.itemText}>{REVISION.steps.after.text}</p>
          </li>
        </ol>
        <div className={s.tables}>
          <ScrollTable
            label={REVISION.table.label}
            columns={REVISION.table.columns}
            rows={touched.map((node) => [node.label, node.note, sentence(node.status)])}
          />
          <ul className={s.sources}>
            {sources.map((source) => (
              <li key={source[2]} className={s.source}>
                <span className={s.sourceName}>{source[0]}</span>
                <span className={s.sourceNote}>{source[1]} · {source[3]}</span>
                <a className={s.sourceLink} href={source[2]} target="_blank" rel="noopener noreferrer" aria-label={`${REVISION.linkLabel}: ${source[0]} (opens in a new tab)`}>
                  {REVISION.linkLabel}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section surface="paper" title={TIMELINE.title} lead={TIMELINE.lead}>
        <div className={s.tagRow}>
          <Tag kind="Sample" />
        </div>
        <ol className={s.steps}>
          {exploreChangeTimeline.map((step) => (
            <li key={step.id} className={s.stepItem}>
              <p className={s.stepHead}>
                <b className={s.stepName}>{step.from} → {step.to}</b>
                <span className={s.stepArrival}>{step.arrival.label}</span>
              </p>
              <dl className={s.rows}>
                <div className={s.row}>
                  <dt className={s.rowName}>{TIMELINE.rows.objects}</dt>
                  <dd className={s.rowValue}>
                    +{count(step.objects.added)} new · {count(step.objects.rebuilt)} rebuilt · {count(step.objects.untouched)} untouched
                  </dd>
                </div>
                <div className={s.row}>
                  <dt className={s.rowName}>{TIMELINE.rows.regions}</dt>
                  <dd className={s.rowValue}>
                    +{count(step.evidenceRegions.added)} new · {count(step.evidenceRegions.changed)} changed
                  </dd>
                </div>
                <div className={s.row}>
                  <dt className={s.rowName}>{TIMELINE.rows.pages}</dt>
                  <dd className={s.rowValue}>
                    {count(step.arrival.compiledPageCount)} of {count(step.arrival.pageCount)} filed · accession {step.arrival.accession}
                  </dd>
                </div>
              </dl>
              <p className={s.digests}>
                <span>{shortDigest(step.fromDigest)}</span>
                <span aria-hidden="true">→</span>
                <span>{shortDigest(step.toDigest)}</span>
              </p>
            </li>
          ))}
        </ol>
        <p className={s.stepsLink}>
          <Link className={s.textLink} href={TIMELINE.link.href} prefetch={false}>{TIMELINE.link.label} →</Link>
        </p>
      </Section>

      <Section surface="light" eyebrow={COVERS.eyebrow} title={COVERS.title}>
        <ul className={s.covers}>
          {COVERS.items.map((item, i) => (
            <li key={item.title} className={s.cover}>
              <p className={s.kicker}>{ordinal(i)}</p>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="green" eyebrow={ACTIVATE.eyebrow} title={ACTIVATE.title}>
        <ol className={s.covers}>
          {ACTIVATE.steps.map((step, i) => (
            <li key={step.title} className={s.cover}>
              <p className={s.kicker}>{ordinal(i)}</p>
              <h3 className={s.itemTitle}>{step.title}</h3>
              <p className={s.itemText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Bridge eyebrow={BRIDGE.eyebrow} title={BRIDGE.title} href={BRIDGE.href} label={BRIDGE.label} />

      <FinalCta title={FINAL.title} />
    </>
  );
}

export default function Changes() {
  return (
    <V34Page route="changes" surface="paper">
      <RouteJsonLd route="changes" />
      <ChangesBody />
    </V34Page>
  );
}
