import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import s from "./community.module.css";

const record = v34Route("community");
const CONNECT = v34Route("connect").path;
const DEVELOPERS = v34Route("developers").path;

const SHARED = [
  { title: "Worlds", text: "A public reference World that others can open, read and cite from." },
  { title: "Connection settings", text: "The settings that join a World to an AI client, written out so they can be reused." },
  { title: "Examples", text: "Small, runnable projects that show a World answering with its sources." },
] as const;

const PER_ITEM = [
  ["Author", "Who shared it", "Named on the item"],
  ["Revision", "The version the item was written against", "Pinned on the item"],
  ["Sources", "The records and evidence the item relies on", "Linked from the item"],
  ["Review", "Whether a maintainer has read it", "Shown beside the item"],
] as const;

function Art() {
  return (
    <svg className={s.art} viewBox="0 0 480 300" role="img" aria-label="Three shared items, a World, a connection setting and an example, placed on one shelf.">
      <rect className={s.artLine} x="16" y="236" width="448" height="4" rx="2" />
      {["World", "Setting", "Example"].map((label, i) => (
        <g key={label}>
          <rect className={s.artBox} x={28 + i * 148} y="72" width="124" height="152" rx="10" />
          <text className={s.artText} x={44 + i * 148} y="104">{label}</text>
          <rect className={s.artLine} x={44 + i * 148} y="124" width="92" height="8" rx="3" />
          <rect className={s.artLine} x={44 + i * 148} y="144" width="68" height="8" rx="3" />
          <rect className={s.artBox} x={44 + i * 148} y="188" width="76" height="22" rx="11" />
        </g>
      ))}
      <text className={s.artMuted} x="16" y="272">Shared items</text>
    </svg>
  );
}

export function CommunityBody() {
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={<ButtonLink href={CONNECT} tone="onDark">See how an AI client connects</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="Worlds, connection settings and examples gathered in one place." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="What people share" title="Worlds, settings and examples" lead="Each shared item shows where it came from and what it relies on.">
        <ul className={s.list}>
          {SHARED.map((p) => (
            <li key={p.title} className={s.item}>
              <h3 className={s.itemTitle}>{p.title}</h3>
              <p className={s.itemText}>{p.text}</p>
            </li>
          ))}
        </ul>
        <p className={s.foot}>
          <a className={s.textLink} href={DEVELOPERS}>Start from the developer reference</a>
        </p>
      </Section>

      <Section surface="green" eyebrow="On every item" title="What a shared item shows">
        <ScrollTable label="Details shown on each shared item" columns={["Detail", "What it tells you", "Where it appears"]} rows={PER_ITEM} />
      </Section>

      <FinalCta title="Compile a World of your own first." />
    </>
  );
}

export default function Community() {
  return (
    <V34Page route="community">
      <RouteJsonLd route="community" />
      <CommunityBody />
    </V34Page>
  );
}
