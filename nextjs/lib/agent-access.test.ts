import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_CLIENT_KEY, AGENT_COHORT_MAX, AGENT_LABEL_BATCH_MAX, AGENT_PAGE, AGENT_SCOPE_RATE_LIMITS, AGENT_SCOPES,
  agentProposalsCohortRefusal, agentProposalsEnabled, deriveAgentIdempotencyKey,
} from "./agent-access";
import { AGENT_CLIENT_LABEL_UNVERIFIED, AGENT_PROPOSAL_CONSENT } from "./agent-consent";
import { BILLING_OFFERS, PRICE_BOOK_EXTRA } from "./billing-catalog";
import { PROPOSAL_IDEMPOTENCY_KEY } from "./change-proposals";
import { DEVELOPER_SCOPES } from "./developer-contracts";

const PERSON = "aa000001-0000-4000-8000-0000000000a1";
const GRANT = "bb000002-0000-4000-8000-0000000000b2";
const GRANT_2 = "cc000003-0000-4000-8000-0000000000c3";
const base = { principalId: PERSON, grantId: GRANT, toolName: "propose_compile", clientKey: "client-key-1", index: 0 };

describe("deriveAgentIdempotencyKey", () => {
  it("is 47 characters and fits the stored proposal key pattern", () => {
    const key = deriveAgentIdempotencyKey(base);
    expect(key).toHaveLength(47);
    expect(key.startsWith("agt_")).toBe(true);
    expect(PROPOSAL_IDEMPOTENCY_KEY.test(key)).toBe(true);
  });

  it("stays 47 characters for the longest client key", () => {
    expect(deriveAgentIdempotencyKey({ ...base, clientKey: "k".repeat(128) })).toHaveLength(47);
  });

  it("differs per grant, per tool, per index and per person (namespaces cannot cross)", () => {
    const key = deriveAgentIdempotencyKey(base);
    expect(deriveAgentIdempotencyKey({ ...base, grantId: GRANT_2 })).not.toBe(key);
    expect(deriveAgentIdempotencyKey({ ...base, toolName: "propose_library_labels" })).not.toBe(key);
    expect(deriveAgentIdempotencyKey({ ...base, index: 1 })).not.toBe(key);
    expect(deriveAgentIdempotencyKey({ ...base, principalId: GRANT_2 })).not.toBe(key);
    expect(deriveAgentIdempotencyKey({ ...base })).toBe(key);
  });

  it("refuses every malformed part rather than hashing it", () => {
    const bad: Array<Partial<typeof base>> = [
      { principalId: "not-a-uuid" }, { grantId: "" }, { toolName: "Propose\ncompile" }, { toolName: "" },
      { clientKey: "short" }, { clientKey: "has space ok" }, { clientKey: "k".repeat(129) }, { clientKey: "line\nbreak1" },
      { index: -1 }, { index: 1.5 }, { index: AGENT_LABEL_BATCH_MAX }, { index: Number.NaN },
    ];
    for (const part of bad) expect(() => deriveAgentIdempotencyKey({ ...base, ...part }), JSON.stringify(part)).toThrow(TypeError);
  });

  it("accepts exactly the client keys the proposal key pattern accepts", () => {
    expect(AGENT_CLIENT_KEY.source).toBe(PROPOSAL_IDEMPOTENCY_KEY.source);
  });
});

describe("cohort and flag", () => {
  const env = (cohort: string | undefined) => ({ TAVONEL_AGENT_PROPOSALS_COHORT: cohort });

  it("admits only an exact listed workspace", () => {
    expect(agentProposalsCohortRefusal("pilot-a1", env("pilot-a1, pilot-b2"))).toBeNull();
    expect(agentProposalsCohortRefusal("pilot-b2", env("pilot-a1,pilot-b2"))).toBeNull();
    expect(agentProposalsCohortRefusal("pilot-c3", env("pilot-a1,pilot-b2"))).not.toBeNull();
    expect(agentProposalsCohortRefusal("pilot-a", env("pilot-a1"))).not.toBeNull();
  });

  it("excludes everyone when the cohort is unset, empty or malformed", () => {
    for (const cohort of [undefined, "", " ", "pilot-a1,", "pilot-a1;pilot-b2", "PILOT-a1", "pilot-a1,not-a-key", "pilot-" + "a".repeat(17)]) {
      expect(agentProposalsCohortRefusal("pilot-a1", env(cohort)), String(cohort)).not.toBeNull();
    }
  });

  it("has no 'all' token", () => {
    expect(agentProposalsCohortRefusal("pilot-a1", env("all"))).not.toBeNull();
    expect(agentProposalsCohortRefusal("pilot-a1", env("pilot-a1,all"))).not.toBeNull();
    expect(agentProposalsCohortRefusal("pilot-a1", env("*"))).not.toBeNull();
  });

  it("excludes everyone when the cohort is wider than the cap", () => {
    const keys = Array.from({ length: AGENT_COHORT_MAX }, (_, i) => `pilot-w${i}`);
    expect(agentProposalsCohortRefusal("pilot-w0", env(keys.join(",")))).toBeNull();
    expect(agentProposalsCohortRefusal("pilot-w0", env([...keys, "pilot-extra"].join(",")))).not.toBeNull();
  });

  it("is on only for the exact string true", () => {
    expect(agentProposalsEnabled({ TAVONEL_AGENT_PROPOSALS_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "True", "1", "yes", "on", " true", "true "]) {
      expect(agentProposalsEnabled({ TAVONEL_AGENT_PROPOSALS_ENABLED: value }), String(value)).toBe(false);
    }
  });
});

describe("constants", () => {
  it("agent scopes are disjoint from the developer scopes", () => {
    for (const scope of AGENT_SCOPES) expect((DEVELOPER_SCOPES as readonly string[]).includes(scope)).toBe(false);
    expect(Object.keys(AGENT_SCOPE_RATE_LIMITS).sort()).toEqual([...AGENT_SCOPES].sort());
  });

  it("the agent migration's scope CHECK and rate-limit list name exactly the agent scopes", () => {
    const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20261117130000_agent_proposals.sql"), "utf8");
    expect(sql).toContain(`then scopes <@ array[${AGENT_SCOPES.map((s) => `'${s}'`).join(", ")}]::text[]`);
    expect(sql).toContain(AGENT_SCOPES.map((s) => `'${s}'`).join(", ") + "\n    )");
  });

  it("every page size is a positive integer", () => {
    for (const size of Object.values(AGENT_PAGE)) expect(Number.isSafeInteger(size) && size > 0).toBe(true);
  });
});

describe("consent copy (§2.7)", () => {
  const LABEL = "Claude Code";
  const sentences = [
    AGENT_PROPOSAL_CONSENT.sees(LABEL), AGENT_PROPOSAL_CONSENT.suggests, AGENT_PROPOSAL_CONSENT.cannotChange,
    AGENT_PROPOSAL_CONSENT.cannotReach, AGENT_PROPOSAL_CONSENT.disconnect,
  ];
  const all = [...sentences, AGENT_PROPOSAL_CONSENT.securityNote, AGENT_CLIENT_LABEL_UNVERIFIED];

  it("says exactly the five fixed sentences", () => {
    expect(sentences).toEqual([
      "“Claude Code” will see the list of your documents, the status of your Worlds and compile jobs, the topics, entities, claims and evidence references of your Worlds — including Worlds that are not active yet — and the suggestions it makes.",
      "It can suggest: compiling documents, library labels and label corrections.",
      "It cannot make any of these changes. Each suggestion waits in Changes until it is confirmed in a signed-in TAVONEL session.",
      "It cannot read or upload files from your computer and cannot spend credits.",
      "You can disconnect it at any time here, under Agent access.",
    ]);
    expect(sentences[0]).toContain("the list of your documents");
  });

  it("carries the fixed security note", () => {
    expect(AGENT_PROPOSAL_CONSENT.securityNote).toBe(
      "A suggestion is carried out only when it is confirmed in a signed-in TAVONEL session. Anything that can use that session — including a browser that an agent controls — can confirm.",
    );
    expect(AGENT_CLIENT_LABEL_UNVERIFIED).toBe("(name not verified)");
  });

  it("puts the label only inside the quotes", () => {
    const marker = "LABEL_SLOT";
    const text = AGENT_PROPOSAL_CONSENT.sees(marker);
    expect(text.split(marker)).toHaveLength(2);
    expect(text.startsWith(`“${marker}”`)).toBe(true);
  });

  it("has no digit, no token prefix and no plan name of the catalogue", () => {
    const plans = [...Object.values(BILLING_OFFERS), ...Object.values(PRICE_BOOK_EXTRA)].map((offer) => offer.label);
    expect(plans.length).toBeGreaterThan(0);
    for (const text of all) {
      expect(text, text).not.toMatch(/[0-9]/);
      expect(text.toLowerCase(), text).not.toContain("tvnl_");
      for (const plan of plans) {
        const words = plan.split(/\s+\(/)[0];
        expect(new RegExp(`\\b${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text), `${text} names ${plan}`).toBe(false);
      }
    }
  });

  it("the consent module has no import, require or node: built-in (source test)", () => {
    const source = readFileSync(resolve(import.meta.dirname, "agent-consent.ts"), "utf8");
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toContain("node:");
  });

  it("agent-access does not re-export the consent module", () => {
    const source = readFileSync(resolve(import.meta.dirname, "agent-access.ts"), "utf8");
    expect(source).not.toMatch(/(?:from|import\s*\(|require\s*\()\s*["'][^"']*agent-consent/);
  });
});
