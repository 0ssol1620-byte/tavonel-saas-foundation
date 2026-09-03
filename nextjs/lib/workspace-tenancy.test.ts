import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { foundationWorkspaceId } from "./foundation-pilot";

/*
  One user, one workspace -- and what that means for the Team plan.

  This file exists because "add invitations and seats" looks like a feature and is not one.
  `foundationWorkspaceId` derives the workspace key from the user id, and every product route
  scopes itself with the key that function returns. A second person invited into a workspace
  would authenticate, have their own key computed from their own id, and land in an empty
  workspace of their own -- or, if the derivation were loosened to make the invite work, land
  somewhere the isolation guarantee no longer covers. The first outcome is an invite flow that
  silently does nothing. The second is a cross-tenant leak, which is the first item on this
  repository's stop-the-line list.

  Multi-user membership therefore requires replacing a derived workspace key with a stored one:
  a membership table that every request consults, R2 key namespaces that survive the move, and
  entitlements that follow the workspace rather than the person. That is a tenancy change with
  an ADR and an independent review in front of it, not an afternoon's work behind a Team card.

  So these tests pin the invariant rather than the absence. They fail the moment someone starts
  building the membership surface, which is exactly when the tenancy question has to be asked
  out loud instead of discovered afterwards.
*/

const appDir = resolve(import.meta.dirname, "../app");
const migrationsDir = resolve(import.meta.dirname, "../../supabase/migrations");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("the workspace key is a function of the user", () => {
  it("derives the same key for the same user and a different one for anyone else", () => {
    const user = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    expect(foundationWorkspaceId(user)).toBe(foundationWorkspaceId(user));
    expect(foundationWorkspaceId(user)).not.toBe(foundationWorkspaceId(other));
  });

  it("has no way to place a second person in one workspace", () => {
    /*
      The whole argument in one assertion: the function takes a user and nothing else. It
      cannot be handed an invitation, a workspace or a membership, so there is no argument a
      caller could pass that would put two users in one place.
    */
    expect(foundationWorkspaceId.length).toBe(1);
  });
});

describe("nothing claims a membership feature that the tenancy model cannot carry", () => {
  it("keeps Team on contact sales", () => {
    // The plan whose product this is. `plan-entitlement.test.ts` checks the gate; this checks
    // the reason, so the two do not drift apart if the gate is ever revisited.
    expect(BILLING_OFFERS.studio_access.saleChannel).toBe("contact");
  });

  it("ships no invitation or seat surface while the key is derived", () => {
    /*
      A route here, or a table in a migration, means the tenancy question was answered
      somewhere. This test failing is not a defect to route around -- it is the signal that the
      answer needs to be written down in an ADR and reviewed before the surface ships.
    */
    const routes = walk(appDir).filter((file) => file.endsWith("route.ts"));
    const offending = routes.filter((file) => /invitation|\bseats?\b/i.test(file));
    expect(offending.map((file) => file.slice(appDir.length))).toEqual([]);

    const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
    for (const name of migrations) {
      const sql = readFileSync(resolve(migrationsDir, name), "utf8");
      expect(
        /create table\s+public\.(workspace_invitations|workspace_seats)/i.test(sql),
        `${name} creates a membership surface the workspace key cannot address`,
      ).toBe(false);
    }
  });

  it("records why, where the next person will look", () => {
    // The catalog comment is the durable explanation; a test asserting the comment exists is
    // the cheapest way to keep an explanation from being deleted as noise.
    const catalog = readFileSync(resolve(import.meta.dirname, "billing-catalog.ts"), "utf8");
    expect(catalog).toContain("saleChannel");
    expect(catalog.toLowerCase()).toContain("seat accounting");
  });
});
