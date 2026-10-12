import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  UX11/K23: the import-progress panel keeps reading while work is known to be unfinished.

  This drives the real ConnectionSyncStatus effect, not a copy of its rule. React's hooks are
  replaced by a minimal observer (state slots, effects run synchronously when their deps change,
  cleanup kept for unmount); the JSX runtime is the real one. Nothing is rendered to a DOM and no
  browser is involved: the effect's scheduled read is observed through fake setTimeout and a
  stubbed fetch. Every payload below is an offline fixture; no route, store or provider is called.
*/

const runtime = vi.hoisted(() => ({
  slots: [] as Array<{ kind: "state" | "effect"; value?: unknown; deps?: unknown[]; cleanup?: () => void }>,
  cursor: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useId: () => "import-progress-title",
    useState(initial: unknown) {
      const index = runtime.cursor++;
      const slot = runtime.slots[index] ?? { kind: "state" as const, value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      runtime.slots[index] = slot;
      return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? (next as (previous: unknown) => unknown)(slot.value) : next; }];
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = runtime.cursor++;
      const slot = runtime.slots[index];
      const changed = !slot || !deps || !slot.deps || deps.length !== slot.deps.length
        || deps.some((value, depIndex) => !Object.is(value, slot!.deps![depIndex]));
      if (changed) {
        slot?.cleanup?.();
        const cleanup = effect();
        runtime.slots[index] = { kind: "effect", deps: deps ? [...deps] : undefined, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      }
    },
  };
});

import ConnectionSyncStatus from "@/components/connection-sync-status";

const CONNECTION = "22222222-2222-4222-8222-222222222222";
const SYNC_URL = `/api/v1/oauth-connectors/connections/${CONNECTION}/sync`;
const READ_FAILED = "Import progress could not be read. Refresh to try again.";

type Rendered = { type: unknown; props: { children?: unknown; onClick?: () => void } };
type Reply = () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const props = { connectionId: CONNECTION, revision: 1, getToken: vi.fn(async (): Promise<string | null> => "offline-token") };

function render() {
  runtime.cursor = 0;
  return ConnectionSyncStatus(props) as unknown as Rendered;
}

/** Hook order in the component: jobs, backlog, error, refresh, then the read effect. */
function state() {
  return { jobs: runtime.slots[0].value, backlog: runtime.slots[1].value, error: runtime.slots[2].value };
}

function unmount() {
  for (const slot of runtime.slots) if (slot.kind === "effect") slot.cleanup?.();
}

function walk(node: unknown, visit: (element: Rendered) => void) {
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  visit(node as Rendered);
  walk((node as Rendered).props.children, visit);
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return text((node as Rendered).props.children);
}

/** The effect's read chain is token → fetch → json; settle it without touching timers. */
async function settle() {
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

function serve(...replies: Reply[]) {
  const queue = [...replies];
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("offline fixture: no further read was expected");
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (body: unknown): Reply => async () => ({ ok: true, json: async () => body });
const storeUnavailable: Reply = async () => ({ ok: false, json: async () => ({ code: "JOB_STORE_READ_FAILED" }) });
const networkDown: Reply = async () => { throw new TypeError("offline fixture: network down"); };

function syncJob(state: string, index: number) {
  return { jobId: `offline-fixture-${index}`, state, itemsSeen: 8, itemsDone: 5, errorCode: null };
}

/** The ten listed jobs, all finished, as the route sends them when older work is still waiting. */
const tenFinished = Array.from({ length: 10 }, (_, index) => syncJob(index % 2 ? "failed" : "succeeded", index));
const olderQueued = { queued: 1, leased: 0, window: 50, rowsRead: 11, coverage: "recent_window" };
const drained = { queued: 0, leased: 0, window: 50, rowsRead: 11, coverage: "recent_window" };

describe("import progress keeps reading while work is known to be unfinished", () => {
  beforeEach(() => {
    runtime.slots = [];
    runtime.cursor = 0;
    props.getToken.mockReset();
    props.getToken.mockImplementation(async () => "offline-token");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The per-read deadline is asserted by its argument; its real timer is not left running.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  });
  afterEach(() => {
    unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads again at 5 s when only the backlog shows a queued import older than the ten listed, then stops once it is known drained", async () => {
    const fetchMock = serve(ok({ jobs: tenFinished, backlog: olderQueued }), ok({ jobs: tenFinished, backlog: drained }));
    render();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SYNC_URL);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ authorization: "Bearer offline-token" });
    expect(AbortSignal.timeout).toHaveBeenLastCalledWith(10_000);
    expect(state().backlog).toEqual({ queued: 1, leased: 0, window: 50, rowsRead: 11, coverage: "recent_window" });
    expect(vi.getTimerCount()).toBe(1);

    await advance(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(props.getToken).toHaveBeenCalledTimes(2);
    expect(AbortSignal.timeout).toHaveBeenCalledTimes(2);
    expect(AbortSignal.timeout).toHaveBeenLastCalledWith(10_000);
    expect(state().backlog).toEqual({ queued: 0, leased: 0, window: 50, rowsRead: 11, coverage: "recent_window" });

    // Every listed job is terminal and the count is a known zero: nothing is scheduled.
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a queued listed job", "queued"],
    ["a leased listed job", "leased"],
  ])("still reads again at 5 s for %s, with no backlog reported", async (_label, listed) => {
    const jobs = [syncJob("succeeded", 0), syncJob(listed, 1)];
    const fetchMock = serve(ok({ jobs }), ok({ jobs: [syncJob("succeeded", 0), syncJob("succeeded", 1)] }));
    render();
    await settle();
    expect(state().backlog).toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    await advance(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["a float count", { queued: 1.5, leased: 0, window: 50, rowsRead: 11, coverage: "recent_window" }],
    ["a negative count", { queued: -1, leased: 2, window: 50, rowsRead: 11, coverage: "recent_window" }],
    ["a count sent as a string", { queued: "1", leased: 0, window: 50, rowsRead: 11, coverage: "recent_window" }],
    ["missing leased", { queued: 1, window: 50, rowsRead: 11, coverage: "recent_window" }],
    ["a known zero over the recent window", drained],
    ["a zero with unknown coverage", { queued: 0, leased: 0 }],
    ["a zero under an earlier route's \"complete\"", { queued: 0, leased: 0, window: 50, rowsRead: 3, coverage: "complete" }],
  ])("does not start reading again when the backlog is %s and every listed job is finished", async (_label, backlog) => {
    const fetchMock = serve(ok({ jobs: tenFinished, backlog }));
    render();
    await settle();
    expect(state().jobs).toEqual(tenFinished);
    expect(state().error).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no coverage", { queued: 0, leased: 2 }],
    ["an earlier route's \"complete\"", { queued: 1, leased: 0, window: 50, rowsRead: 3, coverage: "complete" }],
    ["more rows read than the window", { queued: 1, leased: 0, window: 50, rowsRead: 51, coverage: "recent_window" }],
  ])("reads again at 5 s on valid positive counts with %s: the counts are a lower bound", async (_label, backlog) => {
    const fetchMock = serve(ok({ jobs: tenFinished, backlog }), ok({ jobs: tenFinished, backlog: { queued: 0, leased: 0 } }));
    render();
    await settle();
    expect((state().backlog as { coverage: string }).coverage).toBe("unknown");
    expect(vi.getTimerCount()).toBe(1);

    await advance(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Unknown coverage with a zero count is not proof of anything still waiting: it stops here.
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["the store is unavailable", storeUnavailable],
    ["the network is down", networkDown],
    ["the jobs come back malformed", ok({ jobs: [{ jobId: 7, state: "queued" }], backlog: olderQueued })],
  ])("keeps the last known state and schedules nothing more when %s on a polled read", async (_label, failure) => {
    const fetchMock = serve(ok({ jobs: tenFinished, backlog: olderQueued }), failure);
    render();
    await settle();
    const known = state();
    expect(vi.getTimerCount()).toBe(1);

    await advance(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state().jobs).toBe(known.jobs);
    expect(state().backlog).toBe(known.backlog);
    expect(state().error).toBe(READ_FAILED);
    expect(text(render())).toContain(`${READ_FAILED} The result below is the last known state.`);
    expect(text(render())).toContain("At least 1 import not finished · 1 waiting for a worker · 0 being read now.");

    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("schedules nothing when the first read fails, or when there is no session token", async () => {
    const fetchMock = serve(storeUnavailable);
    render();
    await settle();
    expect(state()).toEqual({ jobs: null, backlog: null, error: READ_FAILED });
    expect(vi.getTimerCount()).toBe(0);

    unmount();
    runtime.slots = [];
    props.getToken.mockImplementation(async () => null);
    render();
    await settle();
    expect(state().error).toBe("Sign in again to read import progress.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears the pending read on unmount and aborts the read in flight", async () => {
    const fetchMock = serve(ok({ jobs: tenFinished, backlog: olderQueued }));
    render();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a read from a reply that lands after unmount", async () => {
    let answer!: (reply: Awaited<ReturnType<Reply>>) => void;
    const fetchMock = serve(() => new Promise(resolve => { answer = resolve; }));
    render();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    answer({ ok: true, json: async () => ({ jobs: tenFinished, backlog: olderQueued }) });
    await settle();
    expect(state()).toEqual({ jobs: null, backlog: null, error: null });
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a manual refresh replaces the pending read instead of adding a second loop", async () => {
    const fetchMock = serve(
      ok({ jobs: tenFinished, backlog: olderQueued }),
      ok({ jobs: tenFinished, backlog: olderQueued }),
      ok({ jobs: tenFinished, backlog: drained }),
    );
    let refresh: (() => void) | undefined;
    walk(render(), element => { if (element.type === "button") refresh = element.props.onClick; });
    await settle();
    expect(vi.getTimerCount()).toBe(1);

    await advance(2_000);
    refresh!();
    render();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The earlier timer was cleared by the effect's cleanup; only the refreshed read's remains.
    expect(vi.getTimerCount()).toBe(1);

    await advance(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
