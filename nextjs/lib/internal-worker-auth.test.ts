import { describe, expect, it } from "vitest";
import { isInternalWorkerAuthorized } from "./internal-worker-auth";

const secret = "existing-shared-worker-secret-0123456789";

describe("internal worker auth reuse", () => {
  it("accepts existing FOUNDATION_WORKER_SECRET and CRON_SECRET Bearer credentials", () => {
    expect(isInternalWorkerAuthorized(new Request("https://local.test", {
      headers: { authorization: `Bearer ${secret}` },
    }), { FOUNDATION_WORKER_SECRET: secret })).toBe(true);
    expect(isInternalWorkerAuthorized(new Request("https://local.test", {
      headers: { authorization: `Bearer ${secret}` },
    }), { CRON_SECRET: secret })).toBe(true);
  });

  it("rejects missing, short, wrong and non-Bearer credentials", () => {
    expect(isInternalWorkerAuthorized(new Request("https://local.test"), { FOUNDATION_WORKER_SECRET: secret })).toBe(false);
    expect(isInternalWorkerAuthorized(new Request("https://local.test", {
      headers: { authorization: `Bearer ${secret}` },
    }), { FOUNDATION_WORKER_SECRET: "short" })).toBe(false);
    expect(isInternalWorkerAuthorized(new Request("https://local.test", {
      headers: { authorization: `Basic ${secret}` },
    }), { FOUNDATION_WORKER_SECRET: secret })).toBe(false);
  });
});
