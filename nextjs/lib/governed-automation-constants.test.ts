import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_SCOPE_RATE_LIMITS, AGENT_SCOPES, deriveAgentIdempotencyKey } from "./agent-access";
import { PROPOSAL_ACTION_TYPES, PROPOSAL_IDEMPOTENCY_KEY } from "./change-proposals";
import {
  ACTION_BINDING_KIND, ACTION_PROPOSER_KINDS, ACTION_RISK_TIER, ACTION_TYPE_INTRODUCED_BY, AGENT_PROPOSABLE, AGENT_SCOPE_PLAN,
  APPROVAL_POLICY_FLOOR, APPROVER_ROLE_RANK, APPROVER_ROLES, BINDING_KINDS, DEFAULT_APPROVAL_POLICY, GOVERNED_ACTION_TYPES,
  GOVERNED_FLAGS, GOVERNED_MIGRATION_ORDER, NO_BINDING_DIGEST, POLICY_SETTER_MIN_ROLE, PRINCIPAL_KINDS,
  RESERVED_IDEMPOTENCY_PREFIXES, SKILL_FILABLE_ACTION_TYPES, STANDING_RULE_ACTION_TYPES, STANDING_RULE_MATCHED_PRINCIPALS,
  STEWARD_DEDUPE_PREFIX, STEWARD_ITEM_KINDS, STEWARD_ITEM_PRIORITY, STEWARD_ITEM_STATES, STEWARD_PERSON_TRANSITIONS,
  STEWARD_PRIORITY_CLASSES, STEWARD_PROPOSING_KINDS, STEWARD_SWEEP_TRANSITIONS, actionTypesThrough, agentScopesThrough,
} from "./governed-automation-constants";
import * as constants from "./governed-automation-constants";

const lib = import.meta.dirname;
const migrations = resolve(lib, "..", "..", "supabase", "migrations");
const read = (path: string) => readFileSync(path, "utf8");
const agentMigration = read(resolve(migrations, "20261117130000_agent_proposals.sql"));
const activationMigration = read(resolve(migrations, "20260920120000_atomic_world_activation.sql"));
const quoted = (text: string) => [...text.matchAll(/'([^']*)'/g)].map((match) => match[1]);

/** The text between `start` and the next `;` in a migration: one CHECK or one statement. */
function statement(sql: string, start: string): string {
  const at = sql.indexOf(start);
  expect(at, `${start} is in the migration`).toBeGreaterThanOrEqual(0);
  return sql.slice(at, sql.indexOf(";", at));
}

describe("the module is import-free (source test)", () => {
  it("has no import, require or node: built-in", () => {
    const source = read(resolve(lib, "governed-automation-constants.ts"));
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toContain("node:");
  });
});

describe("the 'existing' rows equal the base head (real migration text and real modules)", () => {
  it("action types: the CHECK of 20261117130000 and PROPOSAL_ACTION_TYPES", () => {
    const check = statement(agentMigration, "add constraint world_change_proposals_action_type_check");
    expect(quoted(check)).toEqual(actionTypesThrough("existing"));
    expect([...PROPOSAL_ACTION_TYPES]).toEqual(actionTypesThrough("existing"));
  });

  it("binding pairs: the pairing CHECK of 20261117130000", () => {
    const check = statement(agentMigration, "add constraint world_change_proposals_binding_pairing_check");
    const pairs = [...check.matchAll(/action_type = '([a-z_]+)' and binding_kind = '([a-z_]+)'/g)].map((m) => [m[1], m[2]]);
    expect(pairs).toEqual(actionTypesThrough("existing").map((type) => [type, ACTION_BINDING_KIND[type]]));
  });

  it("principal kinds: the CHECK of 20261117130000", () => {
    expect(quoted(statement(agentMigration, "add constraint world_change_proposals_principal_kind_check"))).toEqual([...PRINCIPAL_KINDS]);
  });

  it("agent scopes and rate limits: the scope CHECK and lib/agent-access.ts", () => {
    const existing = agentScopesThrough("existing");
    expect([...AGENT_SCOPES]).toEqual(existing);
    const check = statement(agentMigration, "add constraint foundation_api_keys_scopes_by_kind_check");
    expect(check).toContain(`scopes <@ array[${existing.map((s) => `'${s}'`).join(", ")}]::text[]`);
    for (const row of AGENT_SCOPE_PLAN.filter((r) => r.introducedBy === "existing")) {
      expect(AGENT_SCOPE_RATE_LIMITS[row.scope as keyof typeof AGENT_SCOPE_RATE_LIMITS]).toBe(row.ratePerMinute);
    }
  });

  it("the world_activation default is the activation RPC's own role floor (owner or admin)", () => {
    expect(activationMigration).toContain("v_authorization.role not in ('owner', 'admin')");
    expect(DEFAULT_APPROVAL_POLICY.world_activation.minRole).toBe("admin");
    expect(APPROVAL_POLICY_FLOOR.world_activation).toBe("admin");
  });

  it("the agent idempotency namespace is the first reserved prefix", () => {
    const key = deriveAgentIdempotencyKey({
      principalId: "aa000001-0000-4000-8000-0000000000a1", grantId: "bb000002-0000-4000-8000-0000000000b2",
      toolName: "propose_compile", clientKey: "client-key-1", index: 0,
    });
    expect(key.startsWith(RESERVED_IDEMPOTENCY_PREFIXES[0])).toBe(true);
  });
});

describe("every action type has every row (no default anywhere)", () => {
  const tables = { ACTION_TYPE_INTRODUCED_BY, ACTION_RISK_TIER, ACTION_BINDING_KIND, ACTION_PROPOSER_KINDS,
    DEFAULT_APPROVAL_POLICY, APPROVAL_POLICY_FLOOR, POLICY_SETTER_MIN_ROLE };
  it.each(Object.entries(tables))("%s is keyed by exactly GOVERNED_ACTION_TYPES", (_, table) => {
    expect(Object.keys(table).sort()).toEqual([...GOVERNED_ACTION_TYPES].sort());
  });

  it("binding kinds and migration slots are from their lists", () => {
    for (const type of GOVERNED_ACTION_TYPES) {
      expect(BINDING_KINDS).toContain(ACTION_BINDING_KIND[type]);
      expect(GOVERNED_MIGRATION_ORDER).toContain(ACTION_TYPE_INTRODUCED_BY[type]);
    }
  });

  it("the lists grow in migration order and never shrink", () => {
    for (let i = 1; i < GOVERNED_MIGRATION_ORDER.length; i += 1) {
      const before = actionTypesThrough(GOVERNED_MIGRATION_ORDER[i - 1]!);
      expect(actionTypesThrough(GOVERNED_MIGRATION_ORDER[i]!).slice(0, before.length)).toEqual(before);
      expect(agentScopesThrough(GOVERNED_MIGRATION_ORDER[i]!)).toEqual(expect.arrayContaining(agentScopesThrough(GOVERNED_MIGRATION_ORDER[i - 1]!)));
    }
    expect(actionTypesThrough("B-03")).toEqual([...GOVERNED_ACTION_TYPES]);
    expect(agentScopesThrough("B-03")).toEqual(AGENT_SCOPE_PLAN.map((row) => row.scope));
  });

  it("an unknown migration slot is refused, never treated as applied", () => {
    for (const slot of ["B-04", "", "existing "]) {
      expect(() => actionTypesThrough(slot as never)).toThrow(TypeError);
      expect(() => agentScopesThrough(slot as never)).toThrow(TypeError);
    }
  });
});

describe("activation is never automatic", () => {
  it("R2 is world_activation only, and no R3 type exists", () => {
    expect(GOVERNED_ACTION_TYPES.filter((t) => ACTION_RISK_TIER[t] === "R2")).toEqual(["world_activation"]);
    expect(GOVERNED_ACTION_TYPES.filter((t) => ACTION_RISK_TIER[t] === "R3" || ACTION_RISK_TIER[t] === "R0")).toEqual([]);
  });

  it("a standing rule, a steward, a Skill run and an agent never reach an R2 type", () => {
    for (const type of [...STANDING_RULE_ACTION_TYPES, ...SKILL_FILABLE_ACTION_TYPES, ...Object.keys(AGENT_PROPOSABLE)]) {
      expect(ACTION_RISK_TIER[type as keyof typeof ACTION_RISK_TIER], type).toBe("R1");
    }
    for (const type of GOVERNED_ACTION_TYPES.filter((t) => ACTION_RISK_TIER[t] !== "R1")) {
      expect(ACTION_PROPOSER_KINDS[type]).toEqual(["session"]);
    }
  });

  it("standing rules confirm steward compile plans only", () => {
    expect([...STANDING_RULE_ACTION_TYPES]).toEqual(["compile_plan"]);
    expect([...STANDING_RULE_MATCHED_PRINCIPALS]).toEqual(["steward"]);
    expect(ACTION_PROPOSER_KINDS.compile_plan).toContain("steward");
  });

  it("only compile_plan is steward-proposable (the steward never proposes a structure change or an activation)", () => {
    expect(GOVERNED_ACTION_TYPES.filter((t) => ACTION_PROPOSER_KINDS[t].includes("steward"))).toEqual(["compile_plan"]);
  });

  it("no flag name turns activation on without a person", () => {
    for (const name of Object.values(GOVERNED_FLAGS)) {
      expect(name).toMatch(/^TAVONEL_[A-Z_]+$/);
      expect(name).not.toMatch(/ACTIVAT/);
    }
    expect(read(resolve(lib, "governed-automation-constants.ts"))).not.toMatch(/AUTO_?ACTIVATION/);
  });
});

describe("approval policy", () => {
  it("roles rank member < admin < owner", () => {
    expect(APPROVER_ROLES.map((role) => APPROVER_ROLE_RANK[role])).toEqual([1, 2, 3]);
  });

  it("a default equals its floor and never requires four-eyes (absent row = today)", () => {
    for (const type of GOVERNED_ACTION_TYPES) {
      expect(DEFAULT_APPROVAL_POLICY[type]).toEqual({ minRole: APPROVAL_POLICY_FLOOR[type], distinctApprover: false });
      expect(APPROVER_ROLE_RANK[POLICY_SETTER_MIN_ROLE[type]]).toBeGreaterThanOrEqual(APPROVER_ROLE_RANK.admin);
    }
    expect(POLICY_SETTER_MIN_ROLE.world_activation).toBe("owner");
  });
});

describe("steward items", () => {
  it("every kind has a priority class and a distinct dedupe prefix", () => {
    for (const kind of STEWARD_ITEM_KINDS) expect(STEWARD_PRIORITY_CLASSES).toContain(STEWARD_ITEM_PRIORITY[kind]);
    const prefixes = STEWARD_ITEM_KINDS.map((kind) => STEWARD_DEDUPE_PREFIX[kind]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(Object.keys(STEWARD_ITEM_PRIORITY).sort()).toEqual([...STEWARD_ITEM_KINDS].sort());
  });

  it("a conflict and a held extraction never propose (constitution: never auto-resolve an authoritative conflict)", () => {
    expect(STEWARD_PROPOSING_KINDS).not.toContain("active_conflict");
    expect(STEWARD_PROPOSING_KINDS).not.toContain("extraction_held");
  });

  it("the person table is closed over the states and has a row for each", () => {
    expect(Object.keys(STEWARD_PERSON_TRANSITIONS).sort()).toEqual([...STEWARD_ITEM_STATES].sort());
    for (const targets of Object.values(STEWARD_PERSON_TRANSITIONS)) for (const to of targets) expect(STEWARD_ITEM_STATES).toContain(to);
  });

  it("`reopened` behaves as `new`, and only the sweep wakes a snooze", () => {
    expect(STEWARD_PERSON_TRANSITIONS.reopened).toEqual(STEWARD_PERSON_TRANSITIONS.new);
    expect(STEWARD_PERSON_TRANSITIONS.snoozed).not.toContain("new");
    expect(STEWARD_SWEEP_TRANSITIONS).toEqual({ snoozed: ["new"], resolved: ["reopened"] });
  });
});

describe("formats", () => {
  it("the no-binding digest passes every binding check and is no hash output anyone produced", () => {
    expect(NO_BINDING_DIGEST).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(NO_BINDING_DIGEST).toBe(`sha256:${"0".repeat(64)}`);
  });

  it("reserved prefixes are legal key characters and distinct", () => {
    for (const prefix of RESERVED_IDEMPOTENCY_PREFIXES) expect(PROPOSAL_IDEMPOTENCY_KEY.test(`${prefix}abcdefgh`)).toBe(true);
    expect(new Set(RESERVED_IDEMPOTENCY_PREFIXES).size).toBe(RESERVED_IDEMPOTENCY_PREFIXES.length);
  });

  it("agent scopes are unique, namespaced and rate-limited inside the RPC's bound (1..1000)", () => {
    const scopes = AGENT_SCOPE_PLAN.map((row) => row.scope);
    expect(new Set(scopes).size).toBe(scopes.length);
    for (const row of AGENT_SCOPE_PLAN) {
      expect(row.scope).toMatch(/^agent:[a-z]+$/);
      expect(Number.isSafeInteger(row.ratePerMinute) && row.ratePerMinute >= 1 && row.ratePerMinute <= 1000).toBe(true);
    }
    for (const scope of Object.values(AGENT_PROPOSABLE)) expect(scopes).toContain(scope);
  });

  it("every exported number is a positive safe integer", () => {
    const numbers = Object.entries(constants).filter(([, value]) => typeof value === "number");
    expect(numbers.length).toBeGreaterThan(20);
    for (const [name, value] of numbers) {
      if (name === "ABSENT_POLICY_REVISION") expect(value).toBe(0);
      else expect(Number.isSafeInteger(value) && (value as number) > 0, name).toBe(true);
    }
  });
});
