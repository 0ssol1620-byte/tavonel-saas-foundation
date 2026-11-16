import Link from "next/link";
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
import { Tag } from "@/components/v34/ui/tag";
import { ToolList } from "@/components/v34/ui/tool-list";
import { activationPolicy } from "@/lib/activation-policy";
import { OAUTH_CONNECTOR_PROVIDERS, OAUTH_CONNECTOR_SCOPES } from "@/lib/connector-oauth";
import { FIRST_CALL_SNIPPETS } from "@/lib/developer-snippets";
import { MCP_TOOLS, MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { remoteMcpEnabled } from "@/lib/remote-mcp";
import { v34Route } from "@/lib/v34/routes";
import { CodeBlock } from "../developers/code-block";
import {
  BRIDGE, CHANNEL_FILE, CLIENTS, EXPLORE_HREF, FINAL, HERO, SERVER_FILE, SOURCES, SOURCE_AGENT_FILE,
  SOURCE_AGENT_RUNBOOK, STEPS, TOOLS, TRANSPORTS, WORKSPACE_HREF,
} from "./connect-content";
import { AGENT_OPERATIONS, CONNECTORS, CUSTOMER_RUN } from "./connect-sources";
import s from "./connect.module.css";


/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The config block the stdio steps print: the MCP tab of the first-call samples, one source for both pages. */
function stdioConfig(): string {
  const snippet = FIRST_CALL_SNIPPETS.find((entry) => entry.label === "MCP");
  if (!snippet) throw new Error("lib/developer-snippets.ts has no MCP sample for the stdio config block");
  return snippet.body;
}

/** A provider the product connects to has a row here, or the page stops: the list cannot drift from the product. */
function connectorRows() {
  return OAUTH_CONNECTOR_PROVIDERS.map((provider) => {
    const row = CONNECTORS.find((connector) => connector.provider === provider);
    if (!row) throw new Error(`/connect has no row for the OAuth provider "${provider}"`);
    return row;
  });
}

/**
 * A client, a gate of read-only tool ticks (one per tool), and a World. Two lanes reach the gate,
 * a local process and a URL; a dashed return marks the key that can be revoked.
 */
function ClientToWorld() {
  const ticks = MCP_TOOLS.length;
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label={HERO.figure}>
      <rect className={s.box} x="20" y="72" width="64" height="56" rx="6" />
      <path className={s.lane} d="M84 90 H120 L140 66 H176" />
      <path className={s.lane} d="M84 110 H120 L140 134 H176" />
      <circle className={s.dot} cx="120" cy="90" r="4" />
      <circle className={s.dot} cx="120" cy="110" r="4" />
      <rect className={s.gate} x="176" y="48" width="84" height="104" rx="6" />
      {Array.from({ length: ticks }, (_, index) => (
        <line
          key={index}
          className={s.tick}
          x1={190 + index * 8}
          x2={190 + index * 8}
          y1="70"
          y2="130"
        />
      ))}
      <path className={s.lane} d="M260 100 H300" />
      <circle className={s.core} cx="338" cy="100" r="14" />
      <circle className={s.node} cx="338" cy="62" r="6" />
      <circle className={s.node} cx="372" cy="118" r="6" />
      <circle className={s.node} cx="304" cy="132" r="6" />
      <line className={s.edge} x1="338" y1="100" x2="338" y2="62" />
      <line className={s.edge} x1="338" y1="100" x2="372" y2="118" />
      <line className={s.edge} x1="338" y1="100" x2="304" y2="132" />
      <path className={s.revoke} d="M338 156 V182 H52 V132" />
    </svg>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function ConnectBody({ remoteOpen }: { remoteOpen: boolean }) {
  const record = v34Route("connect");
  const countWord = MCP_TOOL_COUNT_WORD;
  const gateClosed = !activationPolicy.customerData.enabled;
  const remoteState = remoteOpen ? TRANSPORTS.remoteOpen : TRANSPORTS.remoteClosed;
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
        art={<Figure art={<ClientToWorld />} caption={HERO.figure} />}
      />

      <Section
        surface="light"
        eyebrow={TRANSPORTS.eyebrow}
        title={TRANSPORTS.title}
        lead={`The same ${countWord} read-only tools are served either way.`}
      >
        <ScrollTable
          label={TRANSPORTS.table}
          columns={TRANSPORTS.columns}
          rows={[TRANSPORTS.local, [...TRANSPORTS.remote, remoteState]]}
        />
      </Section>

      <Section surface="connect" eyebrow={CLIENTS.eyebrow} title={CLIENTS.title} lead={CLIENTS.lead}>
        <p className={s.tagRow}><Tag kind="Configuration steps" /></p>
        <ScrollTable
          label={CLIENTS.table}
          columns={CLIENTS.columns}
          rows={CLIENTS.rows.map(([client, local, url]) => [client, local, remoteOpen ? url : TRANSPORTS.remoteClosed])}
        />
      </Section>

      <Section surface="paper" eyebrow={STEPS.eyebrow} title={STEPS.title}>
        <div className={s.stepsLayout}>
          <ol className={s.steps}>
            {STEPS.items.map((step, index) => (
              <li key={step.title} className={s.step}>
                <p className={s.stepNo}>{ordinal(index)}</p>
                <div className={s.stepBody}>
                  <h3 className={s.stepTitle}>{step.title}</h3>
                  <p className={s.stepText}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className={s.stepAside}>
            <CodeBlock label={STEPS.config} language={STEPS.configLanguage} body={stdioConfig()} />
            <ul className={s.links}>
              <li><TrackedLink className={s.link} event="developer_mcp_started" href={SERVER_FILE} download>{STEPS.files.server}</TrackedLink></li>
              <li><a className={s.link} href={CHANNEL_FILE}>{STEPS.files.channel}</a></li>
              <li><Link className={s.link} href={WORKSPACE_HREF} prefetch={false}>{STEPS.files.workspace}</Link></li>
            </ul>
          </div>
        </div>
      </Section>

      <Section surface="dark" eyebrow={TOOLS.eyebrow} title={TOOLS.title} lead={TOOLS.lead}>
        <ToolList />
      </Section>

      <Section surface="green" eyebrow={SOURCES.eyebrow} title={SOURCES.title} lead={SOURCES.lead}>
        {gateClosed ? (
          <p className={s.notice} role="status">
            <strong>{SOURCES.gate}</strong> {activationPolicy.customerData.reason}{" "}
            <Link className={s.inlineLink} href={v34Route("contact").path} prefetch={false}>{SOURCES.request}</Link>{" "}
            <Link className={s.inlineLink} href={EXPLORE_HREF} prefetch={false}>{SOURCES.explore}</Link>
          </p>
        ) : null}
        <dl className={s.legend}>
          {SOURCES.legend.map(([term, meaning]) => (
            <div key={term} className={s.legendItem}>
              <dt className={s.legendTerm}>{term}</dt>
              <dd className={s.legendMeaning}>{meaning}</dd>
            </div>
          ))}
        </dl>
        <div className={s.cards}>
          {connectorRows().map((connector) => (
            <RecordCard key={connector.provider} kind="Read-only" label={connector.name}>
              <p className={s.cardText}>{connector.description}</p>
              <details className={s.technical}>
                <summary className={s.summary}>{SOURCES.details}</summary>
                <dl className={s.facts}>
                  <div className={s.fact}><dt className={s.factTerm}>{SOURCES.scopes}</dt><dd className={s.factValue}><code>{(OAUTH_CONNECTOR_SCOPES[connector.provider] ?? []).join(" ")}</code></dd></div>
                  <div className={s.fact}><dt className={s.factTerm}>{SOURCES.writes}</dt><dd className={s.factValue}>{SOURCES.writesValue}</dd></div>
                  <div className={s.fact}><dt className={s.factTerm}>{SOURCES.deletion}</dt><dd className={s.factValue}>{connector.deletion}</dd></div>
                  <div className={s.fact}><dt className={s.factTerm}>{SOURCES.cursor}</dt><dd className={s.factValue}>{connector.cursor}</dd></div>
                </dl>
              </details>
            </RecordCard>
          ))}
          {CUSTOMER_RUN.map(([name, description]) => (
            <RecordCard key={name} kind="Customer-run" label={name}>
              <p className={s.cardText}>{description}</p>
            </RecordCard>
          ))}
        </div>
        <details className={s.agent}>
          <summary className={s.summary}>{SOURCES.agentTitle}</summary>
          <ScrollTable label={SOURCES.agentTable} columns={SOURCES.agentColumns} rows={AGENT_OPERATIONS} />
          <ul className={s.links}>
            <li><a className={s.link} href={SOURCE_AGENT_FILE} download>{SOURCES.agentDownload}</a></li>
            <li><a className={s.link} href={SOURCE_AGENT_RUNBOOK}>{SOURCES.agentRunbook}</a></li>
          </ul>
        </details>
      </Section>

      <Bridge title={BRIDGE.title} text={BRIDGE.text} href={BRIDGE.href} label={BRIDGE.label} />
      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default function Connect({ remoteOpen = remoteMcpEnabled() }: { remoteOpen?: boolean } = {}) {
  return (
    <V34Page route="connect" surface="paper">
      <RouteJsonLd route="connect" />
      <ConnectBody remoteOpen={remoteOpen} />
    </V34Page>
  );
}
