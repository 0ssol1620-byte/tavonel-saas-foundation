import Link from "next/link";
import type { Route } from "next";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { TrackedLink } from "@/components/tracked-link";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { ToolList } from "@/components/v34/ui/tool-list";
import { activationPolicy } from "@/lib/activation-policy";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { FIRST_CALL_OPERATION, FIRST_CALL_SNIPPETS } from "@/lib/developer-snippets";
import { DEVELOPER_FILES, DEVELOPER_FILE_COUNT_WORD, MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { PACKAGE_CONTENTS } from "@/lib/package-contents";
import { v34Route } from "@/lib/v34/routes";
import { CodeBlock } from "./code-block";
import {
  BRIDGE, CHANNEL_FILE, FILES, FINAL, FIRST_READ, HERO, JOURNEY, NEXT, OPENAPI_HREF,
  PACKAGE, PATHS, README_FILE, TOOLS, WORKSPACE_HREF,
} from "./developers-content";
import s from "./developers.module.css";


const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** A request with its key, and the result rows it returns, each pinned to a page of its source. */
function RequestToEvidence() {
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label={HERO.figure}>
      <rect className={s.request} x="20" y="40" width="120" height="120" rx="6" />
      <line className={s.rule} x1="36" y1="66" x2="104" y2="66" />
      <line className={s.rule} x1="36" y1="86" x2="124" y2="86" />
      <circle className={s.keyHead} cx="46" cy="124" r="10" />
      <path className={s.keyShaft} d="M56 124 H116 M96 124 V136 M108 124 V132" />
      <path className={s.flow} d="M140 100 H196" />
      <rect className={s.row} x="196" y="34" width="120" height="32" rx="4" />
      <rect className={s.row} x="196" y="84" width="120" height="32" rx="4" />
      <rect className={s.row} x="196" y="134" width="120" height="32" rx="4" />
      <path className={s.pin} d="M316 50 H342 M316 100 H342 M316 150 H342" />
      <rect className={s.page} x="342" y="30" width="40" height="52" rx="3" />
      <rect className={s.page} x="342" y="118" width="40" height="52" rx="3" />
      <rect className={s.mark} x="348" y="48" width="28" height="8" rx="2" />
      <rect className={s.mark} x="348" y="136" width="28" height="8" rx="2" />
    </svg>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function DevelopersBody() {
  const record = v34Route("developers");
  const countWord = MCP_TOOL_COUNT_WORD;
  const gateClosed = !activationPolicy.customerData.enabled;
  const { path, scope, mcpTool } = FIRST_CALL_OPERATION;
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={(
          <>
            <ButtonLink href={HERO.primary.href} tone="primary">{HERO.primary.label}</ButtonLink>
            <ButtonLink href={HERO.secondary.href} tone="secondary">{HERO.secondary.label}</ButtonLink>
          </>
        )}
        art={<Figure art={<RequestToEvidence />} caption={HERO.figure} />}
      />

      <Section surface="green" eyebrow={PATHS.eyebrow} title={PATHS.title}>
        <div className={s.paths}>
          <RecordCard kind={PATHS.live.kind} label={PATHS.live.label}>
            <p className={s.cardText}>
              Read the active World over HTTP, or give an agent the read-only MCP server: {countWord} tools that read
              sources, Worlds, objects, relations and evidence. Always the current active revision, with no copy to keep in step.
            </p>
            <p className={s.cardNote}>{PATHS.live.detail}</p>
          </RecordCard>
          <RecordCard kind={PATHS.portable.kind} label={PATHS.portable.label}>
            <p className={s.cardText}>{PATHS.portable.body}</p>
            <p className={s.cardNote}>{PATHS.portable.detail}</p>
          </RecordCard>
          <RecordCard kind={PATHS.human.kind} label={PATHS.human.label}>
            <p className={s.cardText}>{PATHS.human.body}</p>
            <p className={s.cardNote}>{PATHS.human.detail}</p>
          </RecordCard>
        </div>
      </Section>

      <Section surface="light" eyebrow={JOURNEY.eyebrow} title={JOURNEY.title}>
        <ol className={s.steps}>
          {JOURNEY.items.map((step, index) => (
            <li key={step.title} className={s.step}>
              <p className={s.stepNo}>{ordinal(index)}</p>
              <div className={s.stepBody}>
                <h3 className={s.stepTitle}>{step.title}</h3>
                <p className={s.stepText}>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        {gateClosed ? (
          <p className={s.notice} role="status" data-capability-gate="customerData">
            <strong>{JOURNEY.gate}</strong> {activationPolicy.customerData.reason}{" "}
            <Link className={s.inlineLink} href={v34Route("contact").path} prefetch={false}>{JOURNEY.request}</Link>{" "}
            <Link className={s.inlineLink} href={EXPLORE_CTA.href as Route} prefetch={false}>{EXPLORE_CTA.label}</Link>
          </p>
        ) : null}
      </Section>

      <Section
        surface="paper"
        eyebrow={FIRST_READ.eyebrow}
        title={FIRST_READ.title}
        lead={<>All four perform <code className={s.inlineCode}>GET /api/v1{path}</code> with a key scoped <code className={s.inlineCode}>{scope}</code>.</>}
      >
        <div className={s.samples}>
          {FIRST_CALL_SNIPPETS.map((snippet) => (
            <CodeBlock key={snippet.label} label={`First request in ${snippet.label}`} language={snippet.label} body={snippet.body} />
          ))}
        </div>
        <p className={s.sampleNote}>
          {FIRST_READ.note} <code className={s.inlineCode}>{mcpTool}</code>. {FIRST_READ.keys}{" "}
          <Link className={s.inlineLink} href={WORKSPACE_HREF} prefetch={false}>{FIRST_READ.keysLink}</Link>
        </p>
      </Section>

      <Section surface="dark" eyebrow={TOOLS.eyebrow} title={TOOLS.title} lead={TOOLS.lead}>
        <ToolList />
        <p className={s.sectionLink}>
          <Link className={s.inlineLink} href={v34Route("connect").path} prefetch={false}>{TOOLS.link}</Link>
        </p>
      </Section>

      <Section
        surface="green"
        eyebrow={FILES.eyebrow}
        title={FILES.title}
        lead={`${capitalize(DEVELOPER_FILE_COUNT_WORD)} files, each listed with its sha256 in the distribution record.`}
      >
        <ul className={s.files} aria-label={FILES.table}>
          {DEVELOPER_FILES.map(({ key, file, purpose }) => (
            <li key={key} className={s.file}>
              {key === "mcp" ? (
                <TrackedLink className={s.fileLink} event="developer_mcp_started" href={`/developer/${file}`} download>{file}</TrackedLink>
              ) : (
                <a className={s.fileLink} href={`/developer/${file}`} download>{file}</a>
              )}
              <span className={s.filePurpose}>{purpose}</span>
            </li>
          ))}
        </ul>
        <ul className={s.fileLinks}>
          <li><TrackedLink className={s.inlineLink} event="developer_api_started" href={OPENAPI_HREF}>{FILES.links.openapi}</TrackedLink></li>
          <li><a className={s.inlineLink} href={CHANNEL_FILE}>{FILES.links.channel}</a></li>
          <li><a className={s.inlineLink} href={README_FILE}>{FILES.links.readme}</a></li>
        </ul>
      </Section>

      <Section surface="light" eyebrow={PACKAGE.eyebrow} title={PACKAGE.title} lead={PACKAGE.lead}>
        <ScrollTable
          label={PACKAGE.table}
          columns={PACKAGE.columns}
          rows={PACKAGE_CONTENTS.map(([file, purpose]) => [<code key={file} className={s.path}>{file}</code>, purpose])}
        />
      </Section>

      <Section surface="paper" eyebrow={NEXT.eyebrow} title={NEXT.title}>
        <ul className={s.next}>
          {NEXT.items.map((item) => (
            <li key={item.href} className={s.nextItem}>
              <Link className={s.nextLink} href={item.href as Route} prefetch={false}>
                <span className={s.nextTitle}>{item.title} <span aria-hidden="true">→</span></span>
                <span className={s.nextText}>{item.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Bridge title={BRIDGE.title} text={BRIDGE.text} href={BRIDGE.href} label={BRIDGE.label} />
      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default function Developers() {
  return (
    <V34Page route="developers" surface="paper">
      <RouteJsonLd route="developers" />
      <DevelopersBody />
    </V34Page>
  );
}
