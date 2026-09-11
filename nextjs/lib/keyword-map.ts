/**
 * Search-demand seeds, kept apart from search-demand *measurement*.
 *
 * Blueprint sections 11.1-11.4 ask for two things that are easy to collapse into one and must
 * not be: a list of the phrases a customer actually types for the work they are trying to
 * finish, and the measured demand behind each phrase. The first can be written from the product
 * and the routes that exist. The second cannot be written at all from this machine -- Keyword
 * Planner, the Naver keyword tool and Search Console are all account-gated (WG-068/069/070,
 * founder items), and Google Trends is a relative interest curve, never an absolute volume.
 *
 * So every row below carries `measurement: "UNMEASURED"` and a `null` in each numeric field.
 * That is the state, not a placeholder: `validateKeywordRecord` refuses a row that carries a
 * number while claiming to be unmeasured, and `rankByDemand` refuses to order unmeasured rows
 * at all rather than sorting them as if they were zero. Blueprint 11.4's rule -- "do not delete
 * an important product guide by scoring unmeasured demand as 0" -- is the reason that function
 * returns two lists instead of one.
 *
 * Four more rules from 11.2-11.3 are enforced here rather than written down and hoped for:
 *
 *   1. A figure from one tool never lands in a row for another engine. `source_tool` is checked
 *      against `search_engine`, so a Naver number cannot be recorded in a Google row and then
 *      read later as if the two were the same market.
 *   2. `competition_type` names *which* competition figure was collected and carries no value,
 *      because an Ads auction figure is not SEO difficulty and a single numeric field invites
 *      exactly that substitution.
 *   3. One intent has one owning page. Different words for the same job group under one
 *      `canonical_owner`; the test asserts it per `workflow_id::intent`.
 *   4. A row whose owner is a draft cookbook cannot claim evidence. A draft has had no run.
 *
 * What this file is not: it renders on no page and is in no COPY_SURFACES list. A query string
 * is a record of what a stranger typed, not copy this product says, and holding the two to one
 * brand-voice guard would either bar true search terms or teach the next author to soften them.
 * The day a page prints one of these strings, that page joins the copy guards -- not this file.
 */

import { COOKBOOK_SLUGS } from "@/lib/cookbook-content";

/* ------------------------------------------------------------------ vocabulary */

/**
 * The six work packages, spelled as the cookbook slugs they share, plus the one bucket that
 * belongs to no single workflow.
 *
 * The six were typed out here in the lane that wrote this file, because neither
 * `lib/cookbook-content.ts` nor `lib/recipe-intent.ts` existed on that branch and a keyword row
 * still needed a workflow id. Both exist now, so the list is imported rather than carried a
 * third time -- one closed list with one owner, instead of three copies and a test to keep them
 * agreeing. The extra bucket below is deliberately *not* a cookbook and must never join that
 * list: it holds the queries that belong to no single work package.
 */
export const COOKBOOK_WORKFLOW_IDS = COOKBOOK_SLUGS;

export const WORKFLOW_IDS = [...COOKBOOK_WORKFLOW_IDS, "category-and-trust"] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

/** What the searcher is trying to do, not what format of page answers them. */
export const KEYWORD_INTENTS = ["define", "compare", "implement", "verify", "buy", "trust"] as const;
export type KeywordIntent = (typeof KEYWORD_INTENTS)[number];

/**
 * The five answer formats blueprint 11.3 asks a manual search review to choose between.
 *
 * Every row carries an empty array. Deciding which of these a live SERP actually rewards is a
 * judgement made by a person looking at a real result page with a fixed country and language
 * (WG-072); nothing here has done that, and a guessed page type would be indistinguishable from
 * a measured one once written down.
 */
export const SERP_PAGE_TYPES = ["tutorial", "tool", "comparison", "download", "work_landing"] as const;
export type SerpPageType = (typeof SERP_PAGE_TYPES)[number];

export const KEYWORD_SOURCE_TOOLS = ["keyword_planner", "naver_keyword_tool", "search_console", "trends", "manual_serp_review"] as const;
export type KeywordSourceTool = (typeof KEYWORD_SOURCE_TOOLS)[number];

/** Which engine a tool is allowed to speak for. Mixing the two is the error this table exists to stop. */
const TOOL_ENGINE: Record<KeywordSourceTool, "google" | "naver"> = {
  keyword_planner: "google",
  search_console: "google",
  trends: "google",
  manual_serp_review: "google",
  naver_keyword_tool: "naver",
};

/**
 * Whether a reader who follows this row can do the thing today.
 *
 * `activation_needs_team_plan` is the live entitlement, not a hedge: promoting a candidate to an
 * active World requires plan `studio` (Team, `saleChannel: "contact"`), and an Evaluation trial
 * or a Developer subscription is refused with `402 STUDIO_SUBSCRIPTION_REQUIRED`
 * (`lib/billing-catalog.ts`, `app/api/collections/[id]/promote/route.ts`). Every one of the six
 * work packages ends at an approved World, so none of them may be marked `live` while that is
 * true -- `validateKeywordRecord` enforces it. FD-02/FD-14 are the decisions that would change
 * this, and when they do, this field moves because the entitlement moved.
 */
export const PRODUCT_READINESS = ["live", "activation_needs_team_plan", "not_live"] as const;
export type ProductReadiness = (typeof PRODUCT_READINESS)[number];

/**
 * Where to send the searcher. There is deliberately no self-serve trial value.
 *
 * A "start your free trial" destination on a workflow query would imply a self-serve path to an
 * approved World, which is the one thing the entitlement above makes untrue. A reader can still
 * find the trial from `/pricing`; what this map will not do is route a work query straight at it.
 */
export const KEYWORD_CTAS = ["read_docs", "explore_sample", "read_evidence", "compare_plans", "contact_team_plan", "none_yet"] as const;
export type KeywordCta = (typeof KEYWORD_CTAS)[number];

/**
 * Routes that exist and are indexable on this deployment, read off `app/sitemap.ts` ROUTES and
 * `lib/docs-content.ts` DOCS_SECTIONS. A typo in an owner path is a page that will never be
 * written, so the owner is checked against a list rather than accepted as free text.
 */
const LIVE_OWNERS = [
  "/knowledge-compiler",
  "/evidence",
  "/explore",
  "/benchmarks",
  "/developers",
  "/pricing",
  "/security",
  "/sources",
  "/product/continuous-knowledge",
  "/solutions/ai-ready-knowledge",
  "/solutions/document-intelligence",
  "/solutions/source-grounded-assistants",
  "/docs/quickstart",
  "/docs/mcp",
  "/docs/exports",
  "/docs/review",
] as const;

/**
 * Cookbook routes that do not exist yet, and will carry `robots: { index: false }` while their
 * record is `publication: "draft"`. Naming one as a future owner is planning; linking to one is
 * not this file's business, and `evidence_available` on such a row must be `false`.
 */
const DRAFT_OWNERS = [
  "/cookbooks/financial-report-figures-with-provenance",
  "/cookbooks/manual-grounded-support-answers",
] as const;

const OWNERS: readonly string[] = [...LIVE_OWNERS, ...DRAFT_OWNERS];

/* ------------------------------------------------------------------ the record */

export type KeywordRecord = {
  /** The phrase as typed, lower-case, never rewritten into product vocabulary. */
  query: string;
  language: "ko" | "en";
  country: "KR" | "US";
  search_engine: "google" | "naver";
  intent: KeywordIntent;
  workflow_id: WorkflowId;
  /** The one page that answers this intent. Same intent, same owner, whatever words were used. */
  canonical_owner: string;
  source_tool: KeywordSourceTool | null;
  /** The window a figure was measured over, ISO `YYYY-MM..YYYY-MM`. Null while unmeasured. */
  measured_period: string | null;
  measured_at: string | null;
  /** A point estimate, when a tool gives one. `0` only if a tool measured zero. */
  monthly_searches: number | null;
  /** The bucket a tool gives instead of a point, verbatim ("100-1K"). Never both. */
  range: string | null;
  /** Which competition figure exists, never a difficulty score. */
  competition_type: "ads_auction" | "organic_difficulty" | null;
  SERP_page_types: readonly SerpPageType[];
  /** Is there a page or receipt on this deployment the content could cite today. */
  evidence_available: boolean;
  product_ready: ProductReadiness;
  CTA: KeywordCta;
  measurement: "UNMEASURED" | "MEASURED";
};

/* ------------------------------------------------------------------ validation */

/**
 * Returns the reasons a record may not be used, in order. An empty array means the row is
 * internally honest -- not that its demand is known.
 */
export function validateKeywordRecord(record: KeywordRecord): readonly string[] {
  const problems: string[] = [];

  if (record.query !== record.query.trim() || record.query === "") problems.push("query is empty or padded");
  if (record.query !== record.query.toLowerCase()) problems.push("query is not recorded as typed (lower-case)");
  if (!WORKFLOW_IDS.includes(record.workflow_id)) problems.push(`workflow_id ${record.workflow_id} is not in the closed list`);
  if (!OWNERS.includes(record.canonical_owner)) problems.push(`canonical_owner ${record.canonical_owner} is not a known route`);

  const unmeasured = record.measurement === "UNMEASURED";
  if (unmeasured) {
    if (record.monthly_searches !== null) problems.push("UNMEASURED row carries a monthly_searches figure");
    if (record.range !== null) problems.push("UNMEASURED row carries a range");
    if (record.competition_type !== null) problems.push("UNMEASURED row names a competition figure");
    if (record.SERP_page_types.length > 0) problems.push("UNMEASURED row asserts SERP page types no review produced");
    if (record.source_tool !== null) problems.push("UNMEASURED row credits a source tool");
    if (record.measured_period !== null || record.measured_at !== null) problems.push("UNMEASURED row carries a measurement date");
  } else {
    if (record.monthly_searches === null && record.range === null) problems.push("MEASURED row carries no figure");
    if (record.monthly_searches !== null && record.range !== null) problems.push("MEASURED row carries both a point and a range");
    if (record.monthly_searches !== null && record.monthly_searches < 0) problems.push("monthly_searches is negative");
    if (record.source_tool === null) problems.push("MEASURED row names no source tool");
    if (record.measured_period === null || record.measured_at === null) problems.push("MEASURED row carries no period or date");
  }

  if (record.source_tool && TOOL_ENGINE[record.source_tool] !== record.search_engine) {
    problems.push(`${record.source_tool} does not measure ${record.search_engine}`);
  }

  if (COOKBOOK_WORKFLOW_IDS.includes(record.workflow_id as (typeof COOKBOOK_WORKFLOW_IDS)[number]) && record.product_ready === "live") {
    problems.push("a work package that ends at an approved World cannot be product_ready live while promote requires the Team plan");
  }
  if (record.product_ready === "not_live" && (record.CTA === "compare_plans" || record.CTA === "contact_team_plan")) {
    problems.push("a not_live capability may not carry a sales CTA");
  }
  if ((record.CTA === "read_evidence" || record.CTA === "explore_sample") && !record.evidence_available) {
    problems.push("CTA points at evidence this row says does not exist");
  }
  if (DRAFT_OWNERS.includes(record.canonical_owner as (typeof DRAFT_OWNERS)[number]) && record.evidence_available) {
    problems.push("a draft cookbook has had no run and cannot be cited as evidence");
  }

  return problems;
}

/* ------------------------------------------------------------------ selection */

/**
 * The hard gates blueprint 11.4 applies before demand is looked at. Two are properties of the
 * record; two are properties of the world outside it and have to be cleared by name.
 */
export const HARD_GATES = ["product_capability_live", "journey_completed_end_to_end", "source_rights_cleared", "security_gate_open"] as const;
export type HardGate = (typeof HARD_GATES)[number];

/**
 * Which gates this row does not clear. `cleared` is the caller's list of gates verified
 * elsewhere -- `docs/gtm/SOURCE_RIGHTS_MANIFEST.yaml` for rights, `docs/CUSTOMER_DATA_GATE_2026-09-06.md`
 * for the security gate -- and defaults to none, so a caller that knows nothing blocks
 * everything. Today no row clears all four, which is the accurate state of the campaign and not
 * a bug in this function.
 */
export function hardGateBlockers(record: KeywordRecord, cleared: readonly HardGate[] = []): readonly HardGate[] {
  const blocked: HardGate[] = [];
  if (record.product_ready !== "live") blocked.push("product_capability_live");
  if (!record.evidence_available) blocked.push("journey_completed_end_to_end");
  blocked.push("source_rights_cleared", "security_gate_open");
  return blocked.filter((gate) => !cleared.includes(gate));
}

/**
 * Orders by measured demand, and hands back everything it refused to order.
 *
 * An unmeasured row is not a weak row. It goes to `unrankable` with its reason so a reader sees
 * a list of two parts rather than a ranking where "no data" looks like "no demand". Rows that
 * were measured under different conditions are refused for the same reason: blueprint 11.2 bars
 * adding or comparing figures across country, language, engine or period, and comparison is
 * what sorting is.
 */
export function rankByDemand(records: readonly KeywordRecord[]): {
  ranked: readonly KeywordRecord[];
  unrankable: readonly { record: KeywordRecord; reason: string }[];
} {
  const unrankable: { record: KeywordRecord; reason: string }[] = [];
  const measured: KeywordRecord[] = [];

  for (const record of records) {
    if (record.measurement === "UNMEASURED") {
      unrankable.push({ record, reason: "demand is UNMEASURED; ranking it would score it as zero" });
    } else if (record.monthly_searches === null) {
      unrankable.push({ record, reason: `demand is a range (${record.range}) and ranges are not ordered against point estimates` });
    } else {
      measured.push(record);
    }
  }

  const scope = (record: KeywordRecord) => `${record.language}::${record.country}::${record.search_engine}::${record.measured_period}`;
  const scopes = new Set(measured.map(scope));
  if (scopes.size > 1) {
    return {
      ranked: [],
      unrankable: [
        ...unrankable,
        ...measured.map((record) => ({ record, reason: `measured under ${scope(record)}; ${scopes.size} different conditions cannot be ranked together` })),
      ],
    };
  }

  return {
    ranked: [...measured].sort((left, right) => (right.monthly_searches ?? 0) - (left.monthly_searches ?? 0)),
    unrankable,
  };
}

/* ------------------------------------------------------------------ the seeds */

const UNMEASURED = {
  source_tool: null,
  measured_period: null,
  measured_at: null,
  monthly_searches: null,
  range: null,
  competition_type: null,
  SERP_page_types: [],
  measurement: "UNMEASURED",
} as const satisfies Partial<KeywordRecord>;

const en = { language: "en", country: "US", search_engine: "google", ...UNMEASURED } as const;

/**
 * A Korean row is a Korean row on Google.
 *
 * `app/robots.ts` names Googlebot, OAI-SearchBot and PerplexityBot and no Naver crawler, and
 * there is no Korean route to rank -- so a Naver row would be a record of demand nothing on this
 * deployment can currently answer or be found for. Naver collection is WG-069, a founder item;
 * when it happens it adds `search_engine: "naver"` rows beside these and never overwrites them.
 *
 * The owner is the English route, because that is the page that exists. When `/ko/<path>` ships
 * (seo-i18n lane) the owner of a Korean row moves to it, one edit per row.
 */
const ko = { language: "ko", country: "KR", search_engine: "google", ...UNMEASURED } as const;

/** 24 English + 24 Korean. Grouped by workflow so the one-owner-per-intent rule is visible. */
export const KEYWORD_SEEDS: readonly KeywordRecord[] = [
  /* --- documents to grounded work (J1) --- */
  { ...en, query: "ground an llm in my own documents", intent: "implement", workflow_id: "documents-to-grounded-work", canonical_owner: "/docs/quickstart", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "answer questions from a folder of pdfs with citations", intent: "implement", workflow_id: "documents-to-grounded-work", canonical_owner: "/docs/quickstart", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "how to give an ai assistant company documents", intent: "implement", workflow_id: "documents-to-grounded-work", canonical_owner: "/docs/quickstart", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "ai ready knowledge base for agents", intent: "define", workflow_id: "documents-to-grounded-work", canonical_owner: "/solutions/ai-ready-knowledge", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "cite the exact source page in an ai answer", intent: "verify", workflow_id: "documents-to-grounded-work", canonical_owner: "/evidence", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "read_evidence" },
  { ...en, query: "document ai pricing per page", intent: "buy", workflow_id: "documents-to-grounded-work", canonical_owner: "/pricing", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "compare_plans" },

  /* --- financial report figures with provenance --- */
  { ...en, query: "extract figures from a financial report with sources", intent: "implement", workflow_id: "financial-report-figures-with-provenance", canonical_owner: "/cookbooks/financial-report-figures-with-provenance", evidence_available: false, product_ready: "not_live", CTA: "read_docs" },
  { ...en, query: "financial statement extraction api", intent: "define", workflow_id: "financial-report-figures-with-provenance", canonical_owner: "/solutions/document-intelligence", evidence_available: false, product_ready: "not_live", CTA: "read_docs" },
  { ...en, query: "10-k data extraction with page citations", intent: "verify", workflow_id: "financial-report-figures-with-provenance", canonical_owner: "/explore", evidence_available: true, product_ready: "not_live", CTA: "explore_sample" },

  /* --- manual grounded support answers --- */
  { ...en, query: "support answers from a product manual with citations", intent: "implement", workflow_id: "manual-grounded-support-answers", canonical_owner: "/cookbooks/manual-grounded-support-answers", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "source grounded assistant for customer support", intent: "define", workflow_id: "manual-grounded-support-answers", canonical_owner: "/solutions/source-grounded-assistants", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },

  /* --- connect external ai (MCP / API) --- */
  { ...en, query: "mcp server for internal documents", intent: "implement", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/docs/mcp", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "connect an ai assistant to company knowledge", intent: "implement", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/docs/mcp", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "agent context infrastructure", intent: "define", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/developers", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "knowledge api pricing for agents", intent: "buy", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/pricing", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "compare_plans" },

  /* --- portable package for a local AI --- */
  { ...en, query: "offline knowledge package for a local llm", intent: "implement", workflow_id: "portable-package-local-ai", canonical_owner: "/docs/exports", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "verify a signed export package", intent: "verify", workflow_id: "portable-package-local-ai", canonical_owner: "/evidence", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "read_evidence" },

  /* --- source revision reuse (J3) --- */
  { ...en, query: "update a rag index when a document changes", intent: "implement", workflow_id: "source-revision-reuse", canonical_owner: "/docs/review", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "keep ai knowledge current when sources change", intent: "define", workflow_id: "source-revision-reuse", canonical_owner: "/product/continuous-knowledge", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...en, query: "check an older answer against a revised document", intent: "verify", workflow_id: "source-revision-reuse", canonical_owner: "/explore", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "explore_sample" },

  /* --- category and trust --- */
  { ...en, query: "what is a knowledge compiler", intent: "define", workflow_id: "category-and-trust", canonical_owner: "/knowledge-compiler", evidence_available: true, product_ready: "live", CTA: "read_docs" },
  { ...en, query: "knowledge compiler vs rag", intent: "compare", workflow_id: "category-and-trust", canonical_owner: "/knowledge-compiler", evidence_available: true, product_ready: "live", CTA: "read_docs" },
  { ...en, query: "document parsing benchmark methodology", intent: "verify", workflow_id: "category-and-trust", canonical_owner: "/benchmarks", evidence_available: true, product_ready: "live", CTA: "read_evidence" },
  { ...en, query: "are my uploaded documents used to train models", intent: "trust", workflow_id: "category-and-trust", canonical_owner: "/security", evidence_available: true, product_ready: "live", CTA: "read_docs" },

  /* --- 한국어 --- */
  { ...ko, query: "사내 문서로 ai 답변 만들기", intent: "implement", workflow_id: "documents-to-grounded-work", canonical_owner: "/docs/quickstart", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "여러 pdf 근거 있는 답변 받기", intent: "implement", workflow_id: "documents-to-grounded-work", canonical_owner: "/docs/quickstart", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "회사 문서 ai 연결 방법", intent: "implement", workflow_id: "documents-to-grounded-work", canonical_owner: "/docs/quickstart", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "ai가 읽을 수 있는 사내 지식 구축", intent: "define", workflow_id: "documents-to-grounded-work", canonical_owner: "/solutions/ai-ready-knowledge", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "ai 답변 출처 원문 확인", intent: "verify", workflow_id: "documents-to-grounded-work", canonical_owner: "/evidence", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "read_evidence" },
  { ...ko, query: "문서 ai 페이지당 비용", intent: "buy", workflow_id: "documents-to-grounded-work", canonical_owner: "/pricing", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "compare_plans" },

  { ...ko, query: "재무보고서 수치 출처까지 추출", intent: "implement", workflow_id: "financial-report-figures-with-provenance", canonical_owner: "/cookbooks/financial-report-figures-with-provenance", evidence_available: false, product_ready: "not_live", CTA: "read_docs" },
  { ...ko, query: "재무제표 추출 api", intent: "define", workflow_id: "financial-report-figures-with-provenance", canonical_owner: "/solutions/document-intelligence", evidence_available: false, product_ready: "not_live", CTA: "read_docs" },
  { ...ko, query: "공시 문서 페이지 근거 확인", intent: "verify", workflow_id: "financial-report-figures-with-provenance", canonical_owner: "/explore", evidence_available: true, product_ready: "not_live", CTA: "explore_sample" },

  { ...ko, query: "매뉴얼 기반 고객 응대 답변", intent: "implement", workflow_id: "manual-grounded-support-answers", canonical_owner: "/cookbooks/manual-grounded-support-answers", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "근거 기반 상담 도우미", intent: "define", workflow_id: "manual-grounded-support-answers", canonical_owner: "/solutions/source-grounded-assistants", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },

  { ...ko, query: "사내 문서 mcp 서버", intent: "implement", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/docs/mcp", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "외부 ai에 사내 지식 연결", intent: "implement", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/docs/mcp", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "에이전트 컨텍스트 인프라", intent: "define", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/developers", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "지식 api 요금", intent: "buy", workflow_id: "connect-external-ai-mcp-api", canonical_owner: "/pricing", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "compare_plans" },

  { ...ko, query: "로컬 ai용 지식 패키지", intent: "implement", workflow_id: "portable-package-local-ai", canonical_owner: "/docs/exports", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "서명된 내보내기 패키지 검증", intent: "verify", workflow_id: "portable-package-local-ai", canonical_owner: "/evidence", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "read_evidence" },

  { ...ko, query: "원문이 바뀌면 인덱스 갱신", intent: "implement", workflow_id: "source-revision-reuse", canonical_owner: "/docs/review", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "문서 개정 반영 지식 관리", intent: "define", workflow_id: "source-revision-reuse", canonical_owner: "/product/continuous-knowledge", evidence_available: false, product_ready: "activation_needs_team_plan", CTA: "read_docs" },
  { ...ko, query: "개정 전 답변과 개정 후 답변 비교", intent: "verify", workflow_id: "source-revision-reuse", canonical_owner: "/explore", evidence_available: true, product_ready: "activation_needs_team_plan", CTA: "explore_sample" },

  { ...ko, query: "지식 컴파일러란", intent: "define", workflow_id: "category-and-trust", canonical_owner: "/knowledge-compiler", evidence_available: true, product_ready: "live", CTA: "read_docs" },
  { ...ko, query: "rag와 지식 그래프 차이", intent: "compare", workflow_id: "category-and-trust", canonical_owner: "/knowledge-compiler", evidence_available: true, product_ready: "live", CTA: "read_docs" },
  { ...ko, query: "문서 ai 벤치마크 방법", intent: "verify", workflow_id: "category-and-trust", canonical_owner: "/benchmarks", evidence_available: true, product_ready: "live", CTA: "read_evidence" },
  { ...ko, query: "업로드한 문서가 모델 학습에 쓰이나", intent: "trust", workflow_id: "category-and-trust", canonical_owner: "/security", evidence_available: true, product_ready: "live", CTA: "read_docs" },
];

/**
 * What is missing, named rather than implied. Each row is the collection that would move
 * `measurement` off `UNMEASURED`, and who can do it.
 *
 * Trends is listed as a reference signal on purpose: it reports relative interest over a window
 * and has no absolute volume to record, so a Trends reading may inform ordering and may never be
 * written into `monthly_searches` (blueprint 11.3, S08).
 */
export const KEYWORD_MEASUREMENT_GAPS = [
  { id: "WG-068", collection: "Google Ads Keyword Planner, country/language/period/network fixed", blocker: "Ads account access", owner: "founder", fields: ["monthly_searches", "range", "competition_type"] },
  { id: "WG-069", collection: "Naver keyword tool, Korean demand recorded as its own rows", blocker: "Naver account access", owner: "founder", fields: ["monthly_searches", "range"] },
  { id: "WG-070", collection: "Search Console query/page/click/impression for this site", blocker: "Search Console access (FD-40)", owner: "founder", fields: ["monthly_searches", "measured_period"] },
  { id: "WG-071", collection: "Google Trends interest over time, as a relative reference only", blocker: "none; but it yields no absolute volume, so no numeric field may be filled from it", owner: "growth", fields: [] },
  { id: "WG-072", collection: "manual review of a live result page to decide the expected answer format", blocker: "a person looking at a real SERP with a fixed country and language", owner: "founder or growth, by hand", fields: ["SERP_page_types"] },
] as const;
