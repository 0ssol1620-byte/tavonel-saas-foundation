import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { h1Text, typedCount } from "./route-test-support";
import RouteStub from "@/components/v34/route-stub";
import { AutopilotBody } from "@/components/v34/routes/autopilot/autopilot";
import { CapabilitiesBody } from "@/components/v34/routes/capabilities/capabilities";
import { CatalogBody } from "@/components/v34/routes/catalog/catalog";
import { ChangesBody } from "@/components/v34/routes/changes/changes";
import { CommunityBody } from "@/components/v34/routes/community/community";
import { CompanyBody } from "@/components/v34/routes/company/company";
import { CompilerBody } from "@/components/v34/routes/compiler/compiler";
import { ConnectBody } from "@/components/v34/routes/connect/connect";
import { ContactBody } from "@/components/v34/routes/contact/contact";
import { CreatorsBody } from "@/components/v34/routes/creators/creators";
import { DevelopersBody } from "@/components/v34/routes/developers/developers";
import { EngineeringBody } from "@/components/v34/routes/engineering/engineering";
import { EnterpriseBody } from "@/components/v34/routes/enterprise/enterprise";
import { EvidenceBody } from "@/components/v34/routes/evidence/evidence";
import { FederationBody } from "@/components/v34/routes/federation/federation";
import { FilmBody } from "@/components/v34/routes/film/film";
import { GovernanceBody } from "@/components/v34/routes/governance/governance";
import { HomeBody } from "@/components/v34/routes/home/home";
import { JournalBody } from "@/components/v34/routes/journal/journal";
import { CompilerBody as JournalCompilerBody } from "@/components/v34/routes/journal-compiler/compiler-article";
import { MarketsBody as JournalMarketsBody } from "@/components/v34/routes/journal-markets/markets-article";
import { McpBody } from "@/components/v34/routes/journal-mcp/mcp-article";
import { PropertyBody } from "@/components/v34/routes/journal-property/property-article";
import { ResearchBody as JournalResearchBody } from "@/components/v34/routes/journal-research/research-article";
import { RevisionBody } from "@/components/v34/routes/journal-revision/revision-article";
import { MarketplaceBody } from "@/components/v34/routes/marketplace/marketplace";
import { MarketsBody } from "@/components/v34/routes/markets/markets";
import { MethodsBody } from "@/components/v34/routes/methods/methods";
import { OutcomesBody } from "@/components/v34/routes/outcomes/outcomes";
import { PersonalBody } from "@/components/v34/routes/personal/personal";
import { PlatformBody } from "@/components/v34/routes/platform/platform";
import { RealestateBody } from "@/components/v34/routes/realestate/realestate";
import { ResearchBody } from "@/components/v34/routes/research/research";
import { ProgramBody } from "@/components/v34/routes/research-program/program";
import { SecurityBody } from "@/components/v34/routes/security/security";
import { SkillsBody } from "@/components/v34/routes/skills/skills";
import { SolutionsBody } from "@/components/v34/routes/solutions/solutions";
import { StewardBody } from "@/components/v34/routes/steward/steward";
import { StudioBody } from "@/components/v34/routes/studio/studio";
import { TeamsBody } from "@/components/v34/routes/teams/teams";
import { TradingBody } from "@/components/v34/routes/trading/trading";
import { WorldBody } from "@/components/v34/routes/world/world";
import { activationPolicy, customerDataState } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { sampleEvidencePage } from "@/lib/evidence-regions";
import { V34_ROUTE_KEYS, v34Route, type V34RouteKey } from "./routes";

/*
  Rules every V34 route body shares, checked once over the rendered bodies rather than re-typed in
  each route's own test: one h1 that is never the document-title form, and no plan named outside
  /pricing. /pricing is the one registry row without a V34 body (it still renders the pricing
  client), and it is the page whose job is to name plans.
*/

const DATES = { published: "2026-11-16", modified: "2026-11-17" };
/** The real policy, so the gate rows render the sentences /api/status serves. */
const STATUS = { activationPolicy: { ...activationPolicy } };

const BODIES: Record<Exclude<V34RouteKey, "pricing">, () => ReactElement> = {
  home: () => createElement(HomeBody),
  platform: () => createElement(PlatformBody),
  world: () => createElement(WorldBody),
  evidence: () => createElement(EvidenceBody, { view: sampleEvidencePage() }),
  changes: () => createElement(ChangesBody),
  autopilot: () => createElement(AutopilotBody),
  connect: () => createElement(ConnectBody, { remoteOpen: true }),
  personal: () => createElement(PersonalBody),
  research: () => createElement(ResearchBody),
  creators: () => createElement(CreatorsBody),
  teams: () => createElement(TeamsBody),
  enterprise: () => createElement(EnterpriseBody),
  developers: () => createElement(DevelopersBody),
  security: () => createElement(SecurityBody),
  governance: () => createElement(GovernanceBody),
  methods: () => createElement(MethodsBody),
  federation: () => createElement(FederationBody),
  capabilities: () => createElement(CapabilitiesBody, { status: STATUS, failed: false }),
  studio: () => createElement(StudioBody),
  solutions: () => createElement(SolutionsBody),
  company: () => createElement(CompanyBody),
  contact: () => createElement(ContactBody),
  compiler: () => createElement(CompilerBody),
  markets: () => createElement(MarketsBody),
  engineering: () => createElement(EngineeringBody),
  billing: () => createElement(RouteStub, { route: "billing", line: "Credits pay for the pages a compile reads." }),
  catalog: () => createElement(CatalogBody),
  marketplace: () => createElement(MarketplaceBody),
  steward: () => createElement(StewardBody),
  skills: () => createElement(SkillsBody),
  outcomes: () => createElement(OutcomesBody),
  film: () => createElement(FilmBody),
  trading: () => createElement(TradingBody),
  realestate: () => createElement(RealestateBody),
  community: () => createElement(CommunityBody),
  journal: () => createElement(JournalBody),
  "journal-compiler": () => createElement(JournalCompilerBody, DATES),
  "journal-mcp": () => createElement(McpBody, DATES),
  "journal-revision": () => createElement(RevisionBody, DATES),
  "journal-markets": () => createElement(JournalMarketsBody, DATES),
  "journal-property": () => createElement(PropertyBody, DATES),
  "journal-research": () => createElement(JournalResearchBody, DATES),
};

const rendered = Object.entries(BODIES).map(([key, body]) => ({ key, html: renderToStaticMarkup(body()) }));
const visible = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("every V34 route body", () => {
  it("covers every registry row but /pricing", () => {
    expect([...Object.keys(BODIES), "pricing"].sort()).toEqual([...V34_ROUTE_KEYS].sort());
  });

  it.each(rendered.map((r) => [r.key, r.html]))("%s renders one non-empty h1 without the brand suffix", (key, html) => {
    const h1 = h1Text(html);
    expect(h1).not.toBe("");
    expect(h1).not.toMatch(/—\s*TAVONEL/);
    // Every body's h1 is its registry heading. The home is the one exception, pinned in the test below.
    if (key !== "home") expect(h1).toBe(v34Route(key as V34RouteKey).heading);
  });

  it("the home is the single exception: its h1 is the hero line reviewed in the home QA, not the registry heading", () => {
    const h1 = h1Text(rendered.find((r) => r.key === "home")!.html);
    expect(h1).toBe("Turn your files into knowledge your AI can trust.");
    expect(h1).not.toBe(v34Route("home").heading);
  });

  it("and /pricing, the legacy client, writes one h1 without the brand suffix", () => {
    const source = readFileSync(join(import.meta.dirname, "../../components/pricing-page-client.tsx"), "utf8");
    const h1s = [...source.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]!.trim());
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).not.toBe("");
    expect(h1s[0]).not.toMatch(/—\s*TAVONEL/);
  });
});

/*
  A plan label used as a plan's name: the label followed by "plan" (or tier, subscription), or the
  label in a list with another capitalised name ("Team and Enterprise"). Labels come from the plan
  catalog and match case-sensitively, so the word "team", the /teams route ("Teams") and a sentence
  that opens on "Team members" do not trip it. Enterprise is sold by contact and has no catalog offer,
  so its label is added by hand.
*/
const LABELS = [...Object.values(BILLING_OFFERS).map((offer) => offer.label), "Enterprise"].join("|");
const LIST = String.raw`\s*(?:,|and|or|&)\s*(?:the\s+)?`;
const PLAN_NAME = new RegExp(
  String.raw`\b(?:${LABELS})\s+(?:plans?|tiers?|subscriptions?)\b|\b(?:${LABELS})${LIST}[A-Z][a-z]+\b|\b[A-Z][a-z]+${LIST}(?:${LABELS})\b`,
);

describe("plan names stay on /pricing", () => {
  it("the pattern finds a plan named as a plan, and leaves the word team alone", () => {
    for (const named of [
      "Once it is open, the Developer plan can be bought online.",
      "Team and Enterprise are arranged with us.",
      "Choose Developer, Team or Enterprise.",
      "On the Team plan you get more pages.",
      "Upgrade to the Team subscription.",
      "Enterprise or Team, scoped with you.",
      "Talk to us about the Enterprise plan.",
      "The Enterprise tier adds review.",
    ]) expect(named).toMatch(PLAN_NAME);
    for (const plain of [
      "Shared Worlds for groups that work together",
      "Teams",
      "A preview of Worlds shared across a team, with review.",
      "Team members review a change before it reaches the World.",
      "Your team reads the same World.",
      "API and MCP reference for developers",
      "Developer documentation and the MCP server",
      "Knowledge compiled for large organizations, across the enterprise.",
      "Built for enterprise teams that answer to auditors.",
      "Enterprise",
    ]) expect(plain).not.toMatch(PLAN_NAME);
  });

  it.each([...rendered, { key: "research-program", html: renderToStaticMarkup(createElement(ProgramBody)) }].map((r) => [r.key, r.html]))(
    "%s names no plan",
    (_key, html) => {
      expect(visible(html)).not.toMatch(PLAN_NAME);
    },
  );

  it("renders the customer-data state without its plan sentence, and the policy still begins with it", () => {
    expect(activationPolicy.customerData.reason.startsWith(`${customerDataState} `)).toBe(true);
    expect(customerDataState).not.toMatch(PLAN_NAME);
    for (const key of ["capabilities", "contact"]) {
      const text = visible(rendered.find((r) => r.key === key)!.html);
      expect(text, key).toContain(customerDataState);
      expect(text, key).not.toContain(activationPolicy.customerData.reason);
    }
  });
});

describe("the shared typed-count pattern", () => {
  const COUNT = typedCount();
  const STRICT = typedCount({ one: true });

  it("catches a number word or digits up to four words before a counted noun", () => {
    const counts = ["three", "Fifteen", "eleven", "twenty-one", "a dozen", "dozens of", "a handful of", "a couple of", "5", "12"];
    const fillers = ["", "of your ", "PDF ", "MCP ", "of your own ", "short 10-K PDF ", "SEC 10-K annual "];
    for (const n of counts) for (const f of fillers) for (const noun of ["files", "PDF", "pages", "filings", "rows", "days", "steps"]) {
      expect(`${n} ${f}${noun}`).toMatch(COUNT);
    }
    for (const typed of [
      "Four things a writer checks", "Four kinds of item reach the briefing", "three dated events and one cutoff",
      "Four layers over one region", "Three frames of the storyboard", "Three fields are needed", "Three required fields",
      "Two characters and a chapter timeline", "two draft branches", "Four dates keep a research replay honest", "Two procedures disagree",
    ]) expect(typed).toMatch(COUNT);
    expect("one file").not.toMatch(COUNT);
    expect("one file").toMatch(STRICT);
    expect("one of your own PDF files").toMatch(STRICT);
  });

  it("leaves identifiers, possessives and uncounted nouns alone", () => {
    for (const ok of [
      "the TRAPPIST-1 star record",
      "the process exits non-zero and reports there",
      "a 10-K filing",
      "three companies' filings",
      "Start with the few files that matter to one goal.",
      "Any MCP client can read the World",
      "<Four items={OWN.items} numbered />",
    ]) expect(ok).not.toMatch(COUNT);
  });
});
