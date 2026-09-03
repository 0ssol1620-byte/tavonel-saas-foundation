# ADR-0001 — Stored workspace identity, and the membership it makes possible

- **Status:** Proposed. Nothing in this document is implemented.
- **Date:** 2026-09-04
- **Branch this was written on:** `agent/industry-leadership-v3`
- **Decision owner:** founder. This ADR does not authorise itself.

## The question

The Team plan is sold as five seats. Membership — invite, accept, roles, revoke — is
straightforward product work in most codebases. It is not straightforward here, and this
document exists to say exactly why before anyone writes the invite form.

## What is true today

`foundationWorkspaceId(userId)` derives the workspace key from the user id. Every product
route, every R2 key prefix and every row's `workspace_key` comes from that derivation. One
user, one workspace, and the workspace's name is a pure function of who is asking.

That is a real isolation property and not an accident: there is no lookup to get wrong, no
join to forget, and no request that can be scoped to a workspace its caller does not own,
because the scope is computed from the caller. `lib/workspace-tenancy.test.ts` pins it.

## Why an invite cannot simply be added

Adding an invitations table on top of a derived key produces one of two outcomes, and both
are worse than not shipping:

1. **The invite silently does nothing.** The invited person signs in, their key is computed
   from their own id, and they land in an empty workspace of their own. Every screen works.
   Nothing errors. They simply never see the World they were invited to.
2. **The derivation is loosened to make the invite work**, and the isolation guarantee stops
   being a property of the code and starts being a property of whichever call sites were
   remembered. A missed one is a cross-tenant read. Cross-tenant leak is the first item on
   this repository's stop-the-line list.

The second is the dangerous one, because it looks like it works.

## Decision

Membership requires replacing a **derived** workspace identity with a **stored** one, as its
own security-critical change on its own branch, with an independent review. It is not a
feature that sits on top of the current model.

Until that lands, the Team plan keeps `saleChannel: "contact"`. It is never opened to
self-serve.

## What the change actually involves

Ten pieces. Any one of them skipped reintroduces the leak the current model prevents.

### 1. Workspace identity becomes a row

A `foundation_workspaces` table owns the key. `foundationWorkspaceId` stops being a
derivation and becomes a lookup of the caller's *current* workspace, resolved once per request
and passed down. The derived value survives exactly once, as the seed for each existing user's
personal workspace during migration.

### 2. Membership table

`foundation_workspace_members (workspace_key, user_id, role, state, invited_by, invited_at,
accepted_at, revoked_at)`. Primary key `(workspace_key, user_id)`. Roles `owner`, `admin`,
`member`, with exactly one `owner` per workspace enforced by a partial unique index rather
than by application code.

### 3. Invite and accept

An invitation is a row, not a signed token that carries authority. Accepting is a state
transition on that row performed by the authenticated invitee, so an intercepted invite link
cannot be redeemed by whoever holds it. Invitations expire, and an expired invitation is a
refused accept and not a silently created member.

### 4. Revoke is immediate, and immediate means immediate

Revocation is a write to the membership row, and every request resolves membership. There is
no cached membership with a TTL, and no background reindex between a revoke and the loss of
access — the constitution's rule that an ACL revoke never waits for a reindex is the same
rule here. Any signed URL already issued is the exception that has to be designed for
explicitly: either short expiries with a documented worst-case window, or a revocation check
at redemption.

### 5. R2 namespace migration

Object keys embed the workspace key. A personal workspace that becomes a team workspace either
keeps its key — preferred, because rewriting immutable object keys contradicts "object storage
is immutable artifact truth" — or every artifact is copied under a new prefix and every stored
digest re-verified. Keeping the key means the key is opaque and no longer means "this user",
which every reader of a key must stop assuming.

### 6. Entitlement ownership

Billing entitlements follow the **workspace**, not the person who bought them. Today they
follow the person, because the two are the same thing. Seat counting is then a property of the
membership table, reconciled against the subscription, with a defined behaviour when a
subscription lapses below the current member count — which is a founder decision about what a
customer sees, not an implementation detail.

### 7. API key ownership

Developer API keys are scoped to a workspace and survive the departure of the person who
created them, or they are scoped to a person and die with their membership. These are
different products. Choosing silently means choosing the one whose failure nobody imagined.

### 8. Migration of existing workspaces

Every current user gets a `foundation_workspaces` row seeded with their derived key and an
`owner` membership. The migration is verified by asserting that every pre-existing row in
every workspace-scoped table has a matching workspace row before the derivation is removed.

### 9. Audit

Invite, accept, role change and revoke are append-only audit events with actor, subject,
timestamp and the workspace they applied to. A membership change with no record of who made it
is not reviewable after the fact, which is when it matters.

### 10. Rollback

The stored-identity change is deployed behind a read path that can fall back to the derivation
while both agree, and the derivation is deleted only after the fallback has been unused in
production for a stated period. Rolling back after the derivation is deleted means restoring
from backup, so the deletion is its own separate, later decision.

## Cross-tenant security tests required before this ships

Not a suggestion; the list.

- A member of workspace A cannot read, write, compile, promote, download, search or ask
  against workspace B, by direct id and by every route that accepts a workspace-scoped
  parameter.
- A revoked member loses every one of those in the same request that follows the revoke.
- An invitation addressed to one person cannot be redeemed by another.
- An API key scoped to workspace A cannot act on workspace B.
- Signed URLs issued before a revoke behave as the design says they do, with the worst-case
  window measured rather than assumed.
- A user with no membership anywhere reaches nothing, rather than reaching an empty workspace
  that later gets populated.
- The pgTAP RLS matrix in `supabase/tests/tenant_rls_matrix.sql` is extended to cover
  membership, and runs against a real database.

## Consequences of doing it

Workspace identity stops being self-evident from a request. That is the cost, and it is paid
in every code path that currently gets isolation for free. It buys the only model in which two
people can see one World.

## Consequences of not doing it

The Team plan stays contact-only. That is the current state and it is honest: the plan is
sold by conversation, nobody is charged for seats that do not exist, and no page promises
five of them.
