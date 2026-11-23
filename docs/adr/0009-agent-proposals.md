# ADR-0009 — An agent proposes, a person confirms (agent proposals v1)

- **Status:** adopted for build, 2026-11-17. Design `[DESIGN]`, nothing proven: every number in it is
  a start value, uncalibrated. Gate U37 stays **OPEN**; this ADR marks no gate passed.
- **Source:** `workorders/agent-native.md` (v34 lanes), revised after its attack and independent
  verification. Work orders WO-AN-1 (this contract) to WO-AN-6.
- **Contract (WO-AN-1):** `supabase/migrations/20261117130000_agent_proposals.sql` (timestamp is a
  placeholder in the serial chain shared with WO-CAT-3..6), its rollback
  `supabase/drafts/rollback-20261117130000-agent-proposals.sql`, `nextjs/lib/agent-access.ts`
  (constants, flag, cohort, stored idempotency key), `nextjs/lib/agent-consent.ts` (consent copy, no
  dependency), `nextjs/scripts/agent-mcp-isolation.mjs` (read-only MCP tripwire).

## Context

People connect AI agents to TAVONEL today through the read-only MCP (`/api/mcp`, nine read tools).
The next step asked for is an agent that can *suggest* changes — compile these documents, label these
documents, correct this label — without being able to make any of them. The read-only MCP must stay
read-only: a write tool there, or an agent credential that works on a REST route, would turn every
connected agent into an actor.

## Decision

Same application, a separate deployment unit inside it:

1. **Separate route:** `POST /api/agent-mcp` (JSON-RPC, six read tools and three propose tools). No
   tool decides, confirms, undoes, activates, cancels or revokes.
2. **Separate audience:** a `tvnl_agt_` credential is a `foundation_api_keys` row with
   `token_kind = 'agent'`, bound to a stable grant (`foundation_agent_grants`) and always expiring.
   It authenticates only inside the agent dispatch; every REST route refuses it, the read-only MCP
   refuses it, session-only routes see no session.
3. **Separate scopes:** `agent:read`, `agent:propose`, disjoint from the developer scopes by a
   database CHECK. The developer key RPC cannot mint an agent key (no grant id).
4. **Separate flag:** `TAVONEL_AGENT_PROPOSALS_ENABLED === "true"` and a cohort of at most twenty exact
   workspace keys (`TAVONEL_AGENT_PROPOSALS_COHORT`, no "all" value). Default off.
5. **A person confirms.** A proposal is a row in `world_change_proposals`; creating one changes
   nothing but that row and the rate window. It is carried out only when confirmed in a signed-in
   TAVONEL session, after the server re-checks access, the preview digest, the binding and (for a
   compile) the quote. The server cannot tell a person's click from a program driving that signed-in
   browser; the consent copy says so.
6. **The agent is the grant, not the key.** Liveness at confirmation, disconnect, "own proposals",
   the open cap (200 per person across all their grants) and the idempotency namespace key on the
   grant. Revoking a grant revokes its key and withdraws its open proposals in one transaction; a
   change of the person's membership revision ends calls at once and makes the grant's open proposals
   decide as `withdrawn`.
7. **Expiry by the database clock.** `decide_world_change_proposal` keeps its `p_now` parameter so the
   deployed caller resolves, and ignores it.

## What v1 excludes, and why

| Excluded | Reason | What must exist first |
|---|---|---|
| Activation (`propose_activation`) | No server-checked re-authentication exists; an agent driving the browser could perform any re-authentication that is not a user-verification ceremony | A re-authentication the server verifies and an agent cannot perform, applied to the manual promote route too |
| Blocker resolution | `resolveCompileJobBlockers` has no expected-set guard | `p_expected_blocked_digest` in the blocker RPC |
| Source connection, compile cancel | Not in the first slice | Executors with named atomic guards |
| Structural ontology patches | Core has no patch evaluation | A pure Core `evaluate_ontology_patch` |
| OAuth for agent hosts | Keeps a second authorization server out of v1 | An OAuth server for `/api/agent-mcp` and a host matrix |
| Credential renewal under one grant | The 30-day credential outlives the 7-day proposal, so a new grant loses nothing confirmable | — |
| Re-charge reservation | No reservation primitive exists for page-meter re-charges; the quote bounds and refuses, it does not reserve | A reservation primitive for rule-4 re-charges |
| Serializing human and agent corrections of one base | The human review path is not changed in v1 | A decision to make the reviews route refuse a second correction of one base |
| An admin disconnecting another member's grant | v1 revoke matches the grant's own person | An admin revoke RPC with its own role check and audit row |
| A third stop switch | Lead decision: flag and revoke-all only | — |

## Runbook — stopping the feature in v1

There are exactly two levers; no third switch is built.

1. *Flag OFF* (`TAVONEL_AGENT_PROPOSALS_ENABLED` unset): **reversible, needs a redeploy**. Calls 404,
   grant creation 404, confirming an agent-origin proposal 409; grants, credentials and open
   proposals survive and work again when the flag returns.
2. *Revoke-all* (`POST /api/internal/agent-grants/revoke-all`): **immediate, irreversible**. Every
   grant and agent credential revoked and every open agent proposal `withdrawn` in one transaction;
   people must create new grants afterwards.

Use 2 when a credential may be in the wrong hands, 1 when the feature itself must pause.

The kill switch disconnects every grant committed before it commits; a grant created afterwards is a new one, and the flag is what forbids new grants.

The flag stops new effects, never a reversal: with it off, a person can still undo an executed agent-origin proposal.

## Rollback

In order: flag off (reversible); revoke-all (irreversible, ends every credential); then, only when
no agent data exists, the rollback draft. The draft refuses — changing nothing — while any agent
proposal, withdrawn proposal, new action type, collection-less proposal, oversized input, agent key
or grant exists; data is never deleted to make it pass. It restores the previous function bodies
(`p_now` decides expiry again), the 0012 rate-limit body and every previous constraint, and drops
the new functions, columns and table. It does not edit the migration tracker; the operator deletes
the version row and records the run in the campaign ledger.

## Limits recorded for v1

| Limit | Owner |
|---|---|
| The grant revoke accepts only the grant's own person; a workspace admin's actions are the membership change or the global revoke-all | agent-native lane (v2) |
| The catalogue text of `API_KEY_AUDIENCE_INVALID` is written for `tvnl_mcp_` and is wrong for an agent credential; a wording change is requested, not made here | catalog lane (WO-CAT-4/5/6) |
| Re-proposing a document set already compiled returns the old job (permanent enqueue idempotency), so the quoted re-charge does not happen; the quote stays an upper bound | compile-jobs / page-meter lane; WO-AN-4 for wording |

## Consequences

- Production applies the migration (release stage 1) after the head migration and before any code
  that passes the new parameters. Old named-argument calls keep resolving: one function each, the
  new parameters trailing with defaults.
- `scripts/agent-mcp-isolation.mjs <base-ref>` fails any agent-proposal PR whose own diff touches a
  read-only MCP file. It judges that PR's diff, not the tree: other work orders may edit the read
  MCP in their own PRs.
- Still OPEN: production apply; real hosts using a bearer-header remote MCP (U36/U21/U13); rate
  windows and the open cap under many instances; whether the action-receipt signer is configured in
  production; the spend ceiling; the production values of the Library organise mode and cohort.
