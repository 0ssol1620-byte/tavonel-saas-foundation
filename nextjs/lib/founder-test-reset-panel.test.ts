import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const panel = readFileSync(resolve(root, "components/founder-test-reset-panel.tsx"), "utf8");
const workspace = readFileSync(resolve(root, "app/workspace/page.tsx"), "utf8");

describe("founder test reset panel", () => {
  it("is founder-only in the client and leaves the server route as the authority", () => {
    expect(panel).toContain("FOUNDER_TEST_RESET_EMAIL");
    expect(panel).toContain("data.session?.user.email?.trim().toLowerCase() === FOUNDER_TEST_RESET_EMAIL");
    expect(panel).toContain('fetch("/api/account/test-reset"');
    expect(panel).toContain("Authorization: `Bearer ${token}`");
  });

  it("requires a fresh manifest and an explicit phrase before deletion", () => {
    expect(panel).toContain('mode: "dry-run"');
    expect(panel).toContain('const CONFIRMATION = "DELETE TEST DATA"');
    expect(panel).toContain("disabled={confirmation !== CONFIRMATION}");
    expect(panel).toContain('mode: "execute"');
    expect(panel).toContain("resetId: state.value.resetId");
    expect(panel).toContain("manifestDigest: state.value.manifestDigest");
  });

  it("mounts only inside workspace settings and states what survives", () => {
    expect(workspace).toContain("<FounderTestResetPanel />");
    expect(panel).toContain("Your sign-in, owner role, founder access, and billing exemption remain.");
  });
});
