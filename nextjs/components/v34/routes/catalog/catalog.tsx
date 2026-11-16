import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import s from "./catalog.module.css";

const record = v34Route("catalog");
const WORLD = v34Route("world").path;
const EVIDENCE = v34Route("evidence").path;

const ENTRIES = [
  { title: "Source terms", text: "The license of each source and what it permits, in plain words beside the entry." },
  { title: "Provenance", text: "Where each record came from, linked to the evidence region that supports it." },
  { title: "Version", text: "A pinned revision, or a channel that follows approved updates." },
  { title: "Ownership", text: "Your private additions stay apart from the licensed collection." },
] as const;

const COMPARE = [
  ["Version", "A fixed manifest", "The current release and its history"],
  ["Evidence", "References as licensed", "References linked to each revision"],
  ["Rights", "Purpose and retrieval limits stated up front", "The same rights, until a new grant is given"],
  ["Composition", "Check upstream grants for compatibility", "Check again when the rights of a source change"],
] as const;

function Art() {
  return (
    <svg className={s.art} viewBox="0 0 480 300" role="img" aria-label="A list of collection entries, each with a source-terms mark.">
      <rect className={s.artBox} x="16" y="24" width="448" height="40" rx="8" />
      <text className={s.artMuted} x="34" y="49">Search collections</text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect className={s.artBox} x="16" y={80 + i * 64} width="448" height="52" rx="8" />
          <rect className={s.artLine} x="32" y={94 + i * 64} width="140" height="10" rx="3" />
          <rect className={s.artLine} x="32" y={112 + i * 64} width="220" height="8" rx="3" />
          <rect className={s.artBox} x="352" y={96 + i * 64} width="96" height="22" rx="11" />
          <text className={s.artMuted} x="378" y={112 + i * 64}>Terms</text>
        </g>
      ))}
    </svg>
  );
}

export function CatalogBody() {
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.title}
        lead={record.description}
        actions={<ButtonLink href={WORLD} tone="onDark">Inspect a public reference World</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="Entries in a catalog, each showing its source terms before it is added." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="Each entry" title="What an entry shows" lead="A collection is described by its sources, its version and its terms.">
        <ul className={s.list}>
          {ENTRIES.map((e) => (
            <li key={e.title} className={s.item}>
              <h3 className={s.itemTitle}>{e.title}</h3>
              <p className={s.itemText}>{e.text}</p>
            </li>
          ))}
        </ul>
        <p className={s.foot}>
          <a className={s.textLink} href={EVIDENCE}>See how evidence is linked to a record</a>
        </p>
      </Section>

      <Section surface="green" eyebrow="Before adding" title="Compare before you add a collection">
        <ScrollTable label="Pinned release compared with a maintained channel" columns={["Inspect", "Pinned release", "Maintained channel"]} rows={COMPARE} />
      </Section>

      <FinalCta title="Compile a World of your own first." />
    </>
  );
}

export default function Catalog() {
  return (
    <V34Page route="catalog">
      <RouteJsonLd route="catalog" />
      <CatalogBody />
    </V34Page>
  );
}
