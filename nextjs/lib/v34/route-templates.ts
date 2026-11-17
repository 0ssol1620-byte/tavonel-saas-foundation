import type { PageTemplate } from "@/components/public-site-chrome";
import type { V34RouteKey } from "./routes";

/*
  The page template (UX-PLAN-2026-10-17 §5.4) each V34 registry route declares as `data-template` on
  its page root (`V34Page`). `null` is the `PublicSitePage` rule: the route is outside §5.4's inventory
  and declares nothing, said here rather than by forgetting. The values are the inventory of
  `e2e/templates.spec.ts` read through the 308s of `V34_REDIRECTS` (next.config.mjs): /product ->
  /platform, /how-it-works -> /methods, /integrations -> /connect, /resources -> /journal and so on.
  /pricing is T2 in the inventory but its page root is `pricing-page-client.tsx`, which declares T2
  itself and does not render `V34Page`, so its row here is null (one declaring root per page).

  Server-only by where it is imported (`components/v34/shell/v34-page.tsx`, a server component), not a
  field of `lib/v34/routes.ts`: that module reaches the client bundle through the nav, and a map no
  client reads stays out of it (WO-CI-20, lead decision 16).
*/
export const ROUTE_TEMPLATES: Readonly<Record<V34RouteKey, PageTemplate | null>> = {
  home: "T0",
  platform: "T1", methods: "T1", connect: "T1", world: "T1", changes: "T1", compiler: "T1",
  "journal-compiler": "T1", solutions: "T1",
  contact: "T2",
  developers: "T3", journal: "T3",
  enterprise: "T5", evidence: "T5", research: "T5", security: "T5",
  autopilot: null, pricing: null, personal: null, creators: null, teams: null, governance: null,
  federation: null, capabilities: null, studio: null, company: null, markets: null, engineering: null,
  billing: null, catalog: null, marketplace: null, steward: null, skills: null, outcomes: null, film: null,
  trading: null, realestate: null, community: null, "journal-mcp": null, "journal-revision": null,
  "journal-markets": null, "journal-property": null, "journal-research": null,
};
