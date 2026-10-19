import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
import { isLiveCommerce, primaryCallToAction, readCommercialState } from "./commercial-state";

const LIVE = {
  COMMERCIAL_MODE: "live",
  PADDLE_SANDBOX: "false",
  TAVONEL_BILLING_LAUNCH_APPROVED: "true",
} as const;

describe("readCommercialState", () => {
  it("defaults to pilot when nothing is configured", () => {
    const state = readCommercialState({});
    expect(state.mode).toBe("pilot");
    expect(state.provider).toBe("production");
    expect(state.liveChargesEnabled).toBe(false);
    expect(state.checkoutEnabled).toBe(false);
    expect(state.legalTermsVersion).toBe("pilot-2026-08-30");
  });

  it("opens live charges only when mode, provider and approval all agree", () => {
    expect(readCommercialState(LIVE).liveChargesEnabled).toBe(true);
    expect(readCommercialState({ ...LIVE, COMMERCIAL_MODE: "pilot" }).liveChargesEnabled).toBe(false);
    expect(readCommercialState({ ...LIVE, TAVONEL_BILLING_LAUNCH_APPROVED: "" }).liveChargesEnabled).toBe(false);
    expect(readCommercialState({ ...LIVE, PADDLE_SANDBOX: "true" }).liveChargesEnabled).toBe(false);
  });

  it("allows real charges only on a production Vercel deployment", () => {
    expect(readCommercialState({ ...LIVE, VERCEL_ENV: "production" }).liveChargesEnabled).toBe(true);
    expect(readCommercialState({ ...LIVE, VERCEL_ENV: "preview" }).liveChargesEnabled).toBe(false);
    expect(readCommercialState({ ...LIVE, VERCEL_ENV: "development" }).liveChargesEnabled).toBe(false);
  });

  /*
    The regression this module exists for. isBillingLaunchApproved() returned true for
    PADDLE_SANDBOX, and Terms/Refunds read it directly, so a sandbox deployment published
    legal copy asserting live paid checkout. Sandbox must be able to open a checkout session
    for qualification without ever moving legal copy to the live template.
  */
  it("never lets a sandbox deployment claim live charges", () => {
    const sandbox = readCommercialState({
      COMMERCIAL_MODE: "live",
      PADDLE_SANDBOX: "true",
      TAVONEL_BILLING_LAUNCH_APPROVED: "true",
      VERCEL_ENV: "preview",
    });
    expect(sandbox.provider).toBe("sandbox");
    expect(sandbox.checkoutEnabled).toBe(true);
    expect(sandbox.liveChargesEnabled).toBe(false);
    expect(sandbox.legalTermsVersion).toBe("pilot-2026-08-30");
  });

  it("keeps production checkout closed until launch is approved", () => {
    const pending = readCommercialState({ ...LIVE, TAVONEL_BILLING_LAUNCH_APPROVED: "false", VERCEL_ENV: "production" });
    expect(pending.checkoutEnabled).toBe(false);
  });

  /*
    G1-001 / G1-010. The card and the compile are two conditions, and this case used to check one.

    `liveChargesEnabled` still means exactly what it meant -- a real card can be charged -- and
    legal and pricing copy still read it directly. What changed is that `isLiveCommerce`, which
    only ever answers "which primary action does the site offer", also requires
    `activationPolicy.customerData`: while that is closed, "Start with your files" describes a
    compile this deployment refuses, and a prerendered page and a dynamic one disagreed about it.
  */
  it("derives one call to action from the same state, and from the customer-data gate", () => {
    // P2-37 (register D-12): the gate is open, so the action follows the card alone.
    expect(activationPolicy.customerData.enabled, "this suite's expectations assume the open gate").toBe(true);
    expect(readCommercialState({ ...LIVE, VERCEL_ENV: "production" }).liveChargesEnabled).toBe(true);
    expect(isLiveCommerce({ ...LIVE, VERCEL_ENV: "production" })).toBe(true);
    expect(isLiveCommerce({ ...LIVE, VERCEL_ENV: "preview" })).toBe(false);
    expect(primaryCallToAction({}).label).toBe("Request access");
    expect(primaryCallToAction({ ...LIVE, VERCEL_ENV: "production" }).label).toBe("Start with your files");
  });

  /*
    The deployment-line test retired with `deploymentStateLine()` itself (2026-09-19, fix round
    2). D2 removed that line from the header and nothing else ever called the function; the
    surfaces that still state the gate verbatim -- /pricing, /security, /integrations, the /docs
    first-run notes and Scene 09 -- are guarded where they render it, not here.
  */
});

/*
  D-13 (register 2026-10-17): launch approval moves out of `vercel.json` into the Foundation
  project's production environment, so approving a launch is an act separate from merging code.

  The runtime read is already environment-first: `readCommercialState` sees `process.env` and
  nothing else, and no runtime path opens `vercel.json`. What the file does is take part in how a
  deployment's environment is built: Vercel applies the project's variables and then the file's
  legacy `env` over them. So while the file carries the key, the file wins, and the move is two
  acts in this order -- the production variable first (founder, docs/runbooks/LAUNCH_WINDOW.md),
  then the PR that deletes the line. Deleting the line first would close checkout in production.

  This models that merge with the real file. It is a model of Vercel's precedence, not a reading of
  a deployment, and it asserts no production value (only variable names were read, 2026-10-19).
*/
describe("D-13: launch approval read from the deployment environment", () => {
  const file = (JSON.parse(readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf8")) as { env?: Record<string, string> }).env ?? {};
  // Project variables first, the file's legacy `env` over them; a production deployment on the live provider.
  const deployed = (project: Record<string, string>, fileEnv: Record<string, string> = file) =>
    readCommercialState({ ...project, ...fileEnv, PADDLE_SANDBOX: "false", VERCEL_ENV: "production" });

  it("today vercel.json carries the approval, so it wins over whatever the project variable says", () => {
    expect(file.TAVONEL_BILLING_LAUNCH_APPROVED).toBe("true");
    const projects: Record<string, string>[] = [{}, { TAVONEL_BILLING_LAUNCH_APPROVED: "false" }, { TAVONEL_BILLING_LAUNCH_APPROVED: "" }, { TAVONEL_BILLING_LAUNCH_APPROVED: "true" }];
    for (const project of projects) {
      expect(deployed(project).liveChargesEnabled, JSON.stringify(project)).toBe(true);
    }
  });

  it("after the line is deleted, only an exact production value approves; unset closes", () => {
    const { TAVONEL_BILLING_LAUNCH_APPROVED: moved, ...remaining } = file;
    expect(moved).toBe("true");
    expect(deployed({ TAVONEL_BILLING_LAUNCH_APPROVED: "true" }, remaining).liveChargesEnabled).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", " true", "true\n", "1"]) {
      const project: Record<string, string> = value === undefined ? {} : { TAVONEL_BILLING_LAUNCH_APPROVED: value };
      expect(deployed(project, remaining).liveChargesEnabled, JSON.stringify(value)).toBe(false);
    }
  });
});
