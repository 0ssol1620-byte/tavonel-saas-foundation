import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuthCallbackPage from "../app/auth/callback/page";
import { failureSentence } from "./workspace-failure-copy";

const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
const connections = readFileSync(new URL("../components/connections-panel.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/compile-job-panel.tsx", import.meta.url), "utf8");

describe("workspace failure copy", () => {
  it("turns a known code into a sentence and never prints the code on its own", () => {
    expect(failureSentence("AUTH_REQUIRED", 401)).toBe("Your session has expired. Sign in again.");
    expect(failureSentence("AUTH_REQUIRED", 401)).not.toContain("AUTH_REQUIRED");
    expect(failureSentence("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403)).toContain("Request source access");
  });

  it("keeps an unmapped code reachable as a reference rather than dropping it", () => {
    const sentence = failureSentence("SOME_NEW_CODE", 500);
    expect(sentence.startsWith("Our servers could not complete this.")).toBe(true);
    expect(sentence).toContain("Reference SOME_NEW_CODE.");
  });

  it("says something useful when there is no code at all", () => {
    expect(failureSentence(null, 429)).toBe("Too many requests at once. Wait a minute and try again.");
    expect(failureSentence(undefined, 404)).not.toContain("Reference");
  });

  /*
    BQ-088 as a source fact: the workspace used to hang `(${json.code ?? response.status})` off
    fifteen otherwise readable lines. One shape, one place, so a new route cannot reintroduce
    the pattern by copying the line above it.
  */
  it("leaves no raw (code ?? status) parenthetical on a customer-facing line", () => {
    for (const [name, source] of [["workspace", workspace], ["connections", connections], ["compile job panel", panel]] as const) {
      expect(source, name).not.toContain("?? response.status})");
      expect(source, name).not.toContain("?? capability.status})");
    }
    expect(workspace).toContain('from "@/lib/workspace-failure-copy"');
  });

  /*
    Journey A1, U8 (JOURNEY-MAP-2026-10-17 D-03, D-13). Before these rows the portal's 409 read
    "Something else changed this first. Reload and look again." and a pilot refusal read "Sign in
    again." -- each a retry that never succeeds.
  */
  it("names the portal, pilot and qualification refusals instead of falling back to a status line", () => {
    for (const [code, status] of [
      ["PADDLE_CUSTOMER_NOT_FOUND", 409],
      ["PILOT_ACCESS_REQUIRED", 403],
      ["PROCESSING_QUALIFICATION_NOT_BILLABLE", 403],
    ] as const) {
      const sentence = failureSentence(code, status);
      expect(sentence, code).not.toContain(code);
      expect(sentence, code).not.toContain("Reference");
      expect(sentence, code).not.toBe(failureSentence(null, status));
    }
    expect(failureSentence("PADDLE_CUSTOMER_NOT_FOUND", 409)).not.toMatch(/reload/i);
    expect(failureSentence("PILOT_ACCESS_REQUIRED", 403)).not.toMatch(/sign in again/i);
    expect(failureSentence("PILOT_ACCESS_REQUIRED", 403)).toContain("contact page");
  });

  it("tells a refused buyer that nothing was charged", () => {
    for (const code of [
      "BILLING_LAUNCH_PENDING",
      "BILLING_NOT_CONFIGURED",
      "BILLING_OFFER_CONTACT_REQUIRED",
      "PROCESSING_QUALIFICATION_NOT_BILLABLE",
    ]) {
      expect(failureSentence(code, 503), code).toContain("nothing was charged");
    }
  });
});

/*
  The callback's access-failed card, rendered from the real component with its state preset.

  The page keeps its phase in `useState`, so a static render only ever reaches "working". As in
  `use-checkout.test.ts`, the component is called once under a dispatcher that answers its three
  `useState`s, two `useRef`s and one `useEffect`, and the element tree it returns is then rendered
  for real. Nothing is mounted, so no bootstrap request is made.
*/
function renderCallback(failureCode: string) {
  const internals = (React as unknown as Record<string, { H: unknown }>)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const states: unknown[] = ["access-failed", failureCode, false];
  let at = 0;
  const previous = internals.H;
  internals.H = {
    useState: () => [states[at++], () => undefined],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => undefined,
  };
  let tree: ReturnType<typeof AuthCallbackPage>;
  try {
    tree = AuthCallbackPage();
  } finally {
    internals.H = previous;
  }
  return renderToStaticMarkup(tree);
}

describe("sign-in callback access refusal (journey A1, D-13)", () => {
  it("sends an account the pilot does not admit to the contact page, not to a retry", () => {
    const html = renderCallback("PILOT_ACCESS_REQUIRED");

    expect(html).toContain("Workspace access needs attention.");
    expect(html).toContain(failureSentence("PILOT_ACCESS_REQUIRED", 403));
    expect(html).toContain('href="/contact"');
    expect(html).toContain(">Contact us<");
    expect(html, "a retry that can never pass is not offered").not.toContain("Try again");
  });

  it("keeps the in-place retry for every other access failure", () => {
    const html = renderCallback("ACCESS_BOOTSTRAP_UNAVAILABLE");

    expect(html).toContain("could not be completed. Please try again");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).not.toContain('href="/contact"');
  });
});
