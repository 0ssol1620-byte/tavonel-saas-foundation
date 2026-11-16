import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import s from "./marketplace.module.css";

const record = v34Route("marketplace");
const WORLD = v34Route("world").path;
const CONTACT = v34Route("contact").path;

const STEPS = [
  { title: "Select a subset", text: "Choose the records, relationships and sources of a World that the listing contains." },
  { title: "Confirm rights", text: "Record who owns each source and what its terms allow, before anything is offered." },
  { title: "Preview evidence", text: "Show the evidence regions behind the records so a reader can inspect them first." },
  { title: "Publish a version", text: "Fix a release with its own identity, so a later revision is a new, dated version." },
] as const;

const FIELDS = [
  ["Source rights", "Owner, origin and the terms of every source behind the listing."],
  ["License scope", "What an AI client may retrieve, and what a licensee may do with the records."],
  ["Release", "The version a licensee receives, and the history of versions before it."],
  ["Evidence", "Coverage of the sources, with a link from each record to its evidence region."],
  ["Updates", "Whether a licensee follows revisions or stays on a pinned release."],
] as const;

const ACCESS = [
  { title: "Pinned", text: "A fixed release under a fixed license term." },
  { title: "Maintained", text: "Later revisions that fall inside the license, with a visible change history." },
  { title: "Private", text: "Terms agreed with a team, including how access is audited." },
] as const;

function Art() {
  return (
    <svg className={s.art} viewBox="0 0 480 300" role="img" aria-label="A World on the left with a subset of its records selected, and a listing card on the right that carries rights, license, release and evidence.">
      <rect className={s.artBox} x="16" y="40" width="170" height="220" rx="10" />
      <text className={s.artText} x="32" y="68">World</text>
      {[92, 120, 148, 176, 204, 232].map((y, i) => (
        <rect key={y} className={i % 2 === 0 ? s.artBox : s.artLine} x="32" y={y - 12} width="138" height="18" rx="4" />
      ))}
      <path className={s.artLine} d="M190 150 H282 M270 138 L284 150 L270 162" />
      <rect className={s.artBox} x="290" y="40" width="174" height="220" rx="10" />
      <text className={s.artText} x="306" y="68">Listing</text>
      {["Rights", "License", "Release", "Evidence"].map((label, i) => (
        <g key={label}>
          <rect className={s.artBox} x="306" y={88 + i * 40} width="142" height="30" rx="6" />
          <text className={s.artMuted} x="320" y={108 + i * 40}>{label}</text>
        </g>
      ))}
    </svg>
  );
}

export function MarketplaceBody() {
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.title.replace(/ — TAVONEL$/, "")}
        lead={record.description}
        actions={<ButtonLink href={WORLD} tone="onDark">Inspect a public reference World</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="A listing carries a chosen subset of a World with its rights, license, release and evidence." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="Publishing" title="From a World to a listing" lead="A listing is a package built from a World, so the private World stays with its owner.">
        <ol className={s.list}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={s.item}>
              <p className={s.kicker}>Step {i + 1}</p>
              <h3 className={s.itemTitle}>{step.title}</h3>
              <p className={s.itemText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="green" eyebrow="Listing page" title="What a listing shows before access" lead="Terms and rights sit on the listing, in view of the person deciding.">
        <ScrollTable label="Fields of a listing" columns={["Field", "What it tells the reader"]} rows={FIELDS} />
      </Section>

      <Section surface="light" eyebrow="Access" title="Ways to hold a release">
        <ul className={s.list}>
          {ACCESS.map((a) => (
            <li key={a.title} className={s.item}>
              <h3 className={s.itemTitle}>{a.title}</h3>
              <p className={s.itemText}>{a.text}</p>
            </li>
          ))}
        </ul>
        <p className={s.foot}>
          <ButtonLink href={CONTACT} tone="secondary">Contact the team</ButtonLink>
        </p>
      </Section>

      <FinalCta title="Compile a World of your own first." />
    </>
  );
}

export default function Marketplace() {
  return (
    <V34Page route="marketplace">
      <RouteJsonLd route="marketplace" />
      <MarketplaceBody />
    </V34Page>
  );
}
