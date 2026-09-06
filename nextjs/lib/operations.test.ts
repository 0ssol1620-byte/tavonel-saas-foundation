import { describe, expect, it } from "vitest";
import { readPublicOperations } from "./operations";

/*
  /status may not render a row without a state. RESOLVED A-6 (2026-09-06).

  The page prints `Object.entries(status.components)` and puts `value.state` in a span, so an
  empty or missing state is an unlabelled row sitting next to labelled ones -- which reads as
  ambiguous rather than as "we do not know", and is the one outcome A-6 forbids. Nothing in
  `readPublicOperations` produces one today: every branch of every component assigns a literal.
  This test is what keeps that true when the next branch is added, and it is why the page needs
  no fallback of its own.

  The vocabulary is closed on purpose. A-6 names NOT CONFIGURED, CLOSED, DISABLED and NOT
  QUALIFIED as the words for a component that is not serving; `operational` and `test_only` are
  the two serving states this deployment can be in. A new word has to be added here, which is
  the moment to ask whether the reader will understand it -- the reason `restricted` is gone: it
  covered both a policy gate held shut and a fully configured billing integration that is
  deliberately not charging, and told the reader neither.
*/
const ALLOWED_STATES = [
  "operational",
  "test_only",
  "not_configured",
  "closed",
  "disabled",
  "not_qualified",
];

describe("public operations", () => {
  it("gives every component a state from the published vocabulary and a detail", () => {
    const { components } = readPublicOperations();
    const names = Object.keys(components);
    expect(names.length).toBeGreaterThan(0);

    for (const [name, component] of Object.entries(components)) {
      expect(ALLOWED_STATES, `${name} renders "${component.state}", which /status cannot explain`)
        .toContain(component.state);
      expect(component.detail.trim(), `${name} must say what it is`).not.toBe("");
    }
  });

  it("reports a phase, a service name and a generation time", () => {
    const status = readPublicOperations();
    expect(["live", "private_pilot"]).toContain(status.phase);
    expect(status.service).toBe("TAVONEL Foundation");
    expect(Number.isNaN(Date.parse(status.generatedAt))).toBe(false);
  });
});
