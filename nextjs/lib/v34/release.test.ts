import { afterEach, describe, expect, it, vi } from "vitest";
import { heldVisible, isHeld, releaseGate } from "./release";

// connection() needs a live request scope; the unit test stands in for it and counts the calls.
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));

afterEach(() => {
  vi.unstubAllEnvs();
  connection.mockClear();
});

function env(vercel: string | undefined, show: string | undefined) {
  vi.stubEnv("VERCEL_ENV", vercel as string);
  vi.stubEnv("V34_SHOW_HELD", show as string);
  if (vercel === undefined) delete process.env.VERCEL_ENV;
  if (show === undefined) delete process.env.V34_SHOW_HELD;
}

const NOT_FOUND = { digest: expect.stringContaining("404") };

describe("release gate", () => {
  it("knows which keys are held", () => {
    expect(isHeld("autopilot")).toBe(true);
    expect(isHeld("journal-property")).toBe(true);
    expect(isHeld("platform")).toBe(false);
  });

  it.each([
    ["production", undefined, false],
    [undefined, undefined, false],
    ["development", undefined, false],
    ["preview", undefined, true],
    ["production", "1", true],
    [undefined, "1", true],
    ["production", "true", false],
    ["production", "0", false],
    ["production", "", false],
  ] as const)("held visible: VERCEL_ENV=%s V34_SHOW_HELD=%s -> %s", async (vercel, show, visible) => {
    expect(heldVisible({ VERCEL_ENV: vercel, V34_SHOW_HELD: show })).toBe(visible);
    env(vercel, show);
    if (visible) await expect(releaseGate("autopilot")).resolves.toBeUndefined();
    else await expect(releaseGate("autopilot")).rejects.toMatchObject(NOT_FOUND);
    expect(connection).toHaveBeenCalledTimes(1);
  });

  /*
    The intended rule, stated once in words (WO-FND-INT-2 item 4). Production without the flag hides every
    held route; V34_SHOW_HELD=1 is how one is opened deliberately, which is why the production environment
    must never carry it (docs/runbooks/RELEASE_ORDER.md, "Held routes in production").
  */
  it("production hides held routes unless V34_SHOW_HELD=1 opens them deliberately", () => {
    expect(heldVisible({ VERCEL_ENV: "production" })).toBe(false);
    expect(heldVisible({ VERCEL_ENV: "production", V34_SHOW_HELD: "1" })).toBe(true);
  });

  it("never gates a live route, in any environment", async () => {
    for (const [vercel, show] of [["production", undefined], [undefined, undefined], ["preview", "1"]] as const) {
      env(vercel, show);
      await expect(releaseGate("platform")).resolves.toBeUndefined();
    }
    expect(connection).not.toHaveBeenCalled();
  });
});
