import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldReadModel } from "./world-read-model";

type AuthResult = { data: { session: { access_token: string } | null } };
type Effect = () => void | (() => void);
type HookSlot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type ElementProps = Record<string, unknown> & { children?: unknown; onClick: () => unknown;
  onChange: (event: { target: { value: string } }) => unknown };

// Actual candidate component execution with deterministic hook scheduling.
// This is neither SSR nor mounted React/browser proof. No external service is contacted.
const runtime = vi.hoisted(() => ({ active: null as Hooks | null, token: "synthetic-token" as string | null, session: null as Promise<AuthResult> | null }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T | (() => T)) => runtime.active!.state(initial),
  useMemo: <T,>(factory: () => T, deps: readonly unknown[]) => runtime.active!.memo(factory, deps),
  useEffect: (effect: Effect, deps: readonly unknown[]) => runtime.active!.effect(effect, deps),
  useId: () => runtime.active!.id(),
}));
vi.mock("./supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({ auth: { getSession: () => runtime.session ?? Promise.resolve({ data: { session: runtime.token ? { access_token: runtime.token } : null } }) } }),
}));
import Panel from "../components/world-version-diff";

type Element = { type: string | symbol | ((props: ElementProps) => unknown); props: ElementProps };
const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
class Hooks {
  slots: HookSlot[] = [];
  pending = new Map<number, Effect>();
  cursor = 0;
  tree: unknown;
  props: Parameters<typeof Panel>[0];
  constructor(props: Parameters<typeof Panel>[0], private component = Panel) { this.props = props; }
  state<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
    const index = this.cursor++;
    if (!this.slots[index]) this.slots[index] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
    return [this.slots[index].value as T, next => {
      this.slots[index].value = typeof next === "function" ? (next as (previous: T) => T)(this.slots[index].value as T) : next;
    }];
  }
  memo<T>(factory: () => T, deps: readonly unknown[]): T {
    const index = this.cursor++;
    if (!same(this.slots[index]?.deps, deps)) this.slots[index] = { deps, value: factory() };
    return this.slots[index].value as T;
  }
  effect(effect: Effect, deps: readonly unknown[]) {
    const index = this.cursor++;
    const prior = this.slots[index];
    if (!same(prior?.deps, deps)) {
      this.slots[index] = { deps, cleanup: prior?.cleanup };
      this.pending.set(index, effect);
    }
  }
  id() { return `synthetic-id-${this.cursor++}`; }
  render() {
    this.cursor = 0;
    runtime.active = this;
    this.tree = this.component(this.props);
    runtime.active = null;
    return this;
  }
  flushEffects() {
    const pending = [...this.pending];
    this.pending.clear();
    for (const [index] of pending) this.slots[index].cleanup?.();
    for (const [index, effect] of pending) this.slots[index].cleanup = effect() as (() => void) | undefined;
    return this;
  }
  dispose() { for (const slot of this.slots) slot?.cleanup?.(); }
}
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const element = value as Element;
  if (typeof element.type === "function") return nodes(element.type(element.props));
  return [element, ...nodes(element.props?.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value !== "object") return String(value);
  const element = value as Element;
  return typeof element.type === "function" ? text(element.type(element.props)) : text(element.props?.children);
}
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const notYet = { state: "not_yet", reason: "Synthetic contract fixture." };
function model(letter = "c", world = "synthetic-world", label = letter): WorldReadModel {
  return {
    world: { id: world, manifestDigest: digest(letter), status: "candidate" },
    history: ["c", "a", "b"].map(value => ({ manifestDigest: digest(value), version: value, status: "candidate", activatedAt: notYet })),
    objects: [{ id: "entity", label, type: "Entity", claims: [], relations: [], evidenceRefs: [], sourceVersions: [] }],
    relations: [], evidence: [], files: [],
    review: { impact: { answerCaches: notYet } },
  } as unknown as WorldReadModel;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type SyntheticResponse = { ok: boolean; json: () => Promise<unknown> };
type Request = ReturnType<typeof deferred<SyntheticResponse>> & { url: string; init?: RequestInit };
let requests: Request[];
let harnesses: Hooks[];
const ticks = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
function request(letter: string, world = "synthetic-world", occurrence = 0) {
  const matches = requests.filter(item => item.url === `/api/v1/world/${world}?manifest=${encodeURIComponent(digest(letter))}`);
  expect(matches.length).toBeGreaterThan(occurrence);
  return matches[occurrence];
}
async function resolve(item: Request, result: WorldReadModel, ok = true) {
  item.resolve({ ok, json: async () => ({ model: result }) });
  await ticks();
}
async function start(current = model(), component = Panel) {
  const calls: string[] = [];
  const hooks = new Hooks({ model: current, onRollback: value => calls.push(value) }, component);
  harnesses.push(hooks);
  hooks.render().flushEffects().render().flushEffects();
  await ticks();
  hooks.render();
  return { hooks, calls };
}
async function readyA() {
  const context = await start();
  await resolve(request("a"), model("a"));
  context.hooks.render();
  expect(text(context.hooks.tree)).toContain("Showing 1 of 1 artifact changes");
  expect(rollback(context.hooks)).toHaveLength(1);
  return context;
}
function select(hooks: Hooks, letter: string) {
  const row = nodes(hooks.tree).find(node => node.type === "li" && text(node).includes(digest(letter).slice(7, 19)));
  const button = nodes(row).find(node => node.type === "button" && text(node) === "Compare");
  expect(button).toBeDefined();
  button!.props.onClick();
  hooks.render();
}
function rollback(hooks: Hooks) {
  return nodes(hooks.tree).filter(node => node.type === "button" && ["Roll back to this version", "Rolling back��"].includes(text(node)));
}
function safePending(hooks: Hooks) {
  expect(text(hooks.tree)).toContain("Reading the other version");
  expect(text(hooks.tree)).not.toContain("Showing ");
  expect(nodes(hooks.tree).filter(node => node.props?.["data-diff-row"] === "true")).toHaveLength(0);
  expect(rollback(hooks)).toHaveLength(0);
}
beforeEach(() => {
  requests = []; harnesses = []; runtime.token = "synthetic-token"; runtime.session = null;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/v1/reviews?")) return Promise.resolve({ ok: true, json: async () => ({ decisions: [] }) });
    const item = { ...deferred<SyntheticResponse>(), url, init }; requests.push(item); return item.promise;
  }));
});
afterEach(() => { harnesses.forEach(hooks => hooks.dispose()); vi.unstubAllGlobals(); });

describe("new comparison binding transitions — deterministic actual-component hooks", () => {
  it("A to B is pending immediately before passive effects; ready B confirms and calls only B", async () => {
    const { hooks, calls } = await readyA();
    select(hooks, "b");
    expect(hooks.pending.size).toBe(1);
    expect(requests).toHaveLength(1); // B's effect has explicitly not run.
    safePending(hooks);
    hooks.flushEffects(); await ticks(); hooks.render(); safePending(hooks);
    await resolve(request("b"), model("b", "synthetic-world", "B prior label")); hooks.render();
    expect(text(hooks.tree)).toContain("B prior label");
    expect(text(hooks.tree)).toContain(`Rolling back to ${digest("b").slice(7, 19)}`);
    rollback(hooks)[0].props.onClick();
    expect(calls).toEqual([digest("b")]);
    expect(request("b").init).toEqual({ headers: { authorization: "Bearer synthetic-token" }, cache: "no-store" });
  });
  it("late A cannot revive rows before B's effect or overwrite ready B after cleanup", async () => {
    const { hooks, calls } = await start();
    select(hooks, "b"); safePending(hooks);
    await resolve(request("a"), model("a")); hooks.render(); safePending(hooks);
    hooks.flushEffects(); await ticks();
    await resolve(request("b"), model("b")); hooks.render();
    rollback(hooks)[0].props.onClick(); expect(calls).toEqual([digest("b")]);
    const second = await start(); select(second.hooks, "b"); second.hooks.flushEffects(); await ticks();
    await resolve(request("b", "synthetic-world", 1), model("b")); second.hooks.render();
    await resolve(request("a", "synthetic-world", 1), model("a", "synthetic-world", "LATE A")); second.hooks.render();
    expect(text(second.hooks.tree)).not.toContain("LATE A");
    rollback(second.hooks)[0].props.onClick(); expect(second.calls).toEqual([digest("b")]);
  });
  it("A to B to A starts a new A request and rejects both superseded unresolved responses", async () => {
    const { hooks, calls } = await start();
    select(hooks, "b"); hooks.flushEffects(); await ticks();
    select(hooks, "a"); safePending(hooks); hooks.flushEffects(); await ticks();
    await resolve(request("a", "synthetic-world", 0), model("a", "synthetic-world", "OLD A")); hooks.render(); safePending(hooks);
    await resolve(request("b"), model("b")); hooks.render(); safePending(hooks);
    await resolve(request("a", "synthetic-world", 1), model("a", "synthetic-world", "FRESH A")); hooks.render();
    expect(text(hooks.tree)).toContain("FRESH A"); expect(text(hooks.tree)).not.toContain("OLD A");
    rollback(hooks)[0].props.onClick(); expect(calls).toEqual([digest("a")]);
  });
  it.each(["current", "world", "model identity"])("%s change invalidates ready A before effects and requires its own response", async kind => {
    const { hooks } = await readyA();
    const next = model(kind === "current" ? "d" : "c", kind === "world" ? "synthetic-next-world" : "synthetic-world", "next current");
    hooks.props = { ...hooks.props, model: next }; hooks.render(); safePending(hooks);
    hooks.flushEffects(); await ticks(); hooks.render(); safePending(hooks);
    await resolve(request("a", next.world.id, kind === "world" ? 0 : 1), model("a", next.world.id, "matching context")); hooks.render();
    expect(text(hooks.tree)).toContain("matching context"); expect(rollback(hooks)).toHaveLength(1);
  });
  it("old request completion cannot revive a changed current/world context before passive cleanup", async () => {
    const { hooks } = await start();
    hooks.props = { ...hooks.props, model: model("d", "synthetic-next-world") }; hooks.render(); safePending(hooks);
    await resolve(request("a"), model("a")); hooks.render(); safePending(hooks);
    hooks.flushEffects(); await ticks();
    await resolve(request("a", "synthetic-next-world"), model("a", "synthetic-next-world")); hooks.render();
    expect(rollback(hooks)).toHaveLength(1);
  });
  it.each(["http", "rejection", "missing auth", "wrong digest", "wrong world"])("%s failure preserves no results/rollback and a new selection is immediately pending", async kind => {
    const { hooks, calls } = await readyA();
    if (kind === "missing auth") runtime.token = null;
    select(hooks, "b"); safePending(hooks); hooks.flushEffects(); await ticks();
    if (kind === "rejection") { request("b").reject(new Error("synthetic failure")); await ticks(); }
    else if (kind !== "missing auth") await resolve(request("b"), model(kind === "wrong digest" ? "a" : "b", kind === "wrong world" ? "other-world" : "synthetic-world"), kind !== "http");
    hooks.render();
    expect(text(hooks.tree)).toContain("artifact could not be read"); expect(text(hooks.tree)).not.toContain("Showing "); expect(rollback(hooks)).toHaveLength(0); expect(calls).toEqual([]);
    select(hooks, "a"); safePending(hooks); expect(text(hooks.tree)).not.toContain("artifact could not be read");
  });
  it("identical and busy ready comparisons keep existing rollback safety", async () => {
    const { hooks, calls } = await start();
    await resolve(request("a"), model("a", "synthetic-world", "c")); hooks.render();
    expect(text(hooks.tree)).toContain("identical"); expect(rollback(hooks)).toHaveLength(0); expect(calls).toEqual([]);
    select(hooks, "b"); safePending(hooks); hooks.flushEffects(); await ticks();
    await resolve(request("b"), model("b")); hooks.props = { ...hooks.props, rollbackBusy: true }; hooks.render();
    const button = nodes(hooks.tree).find(node => node.type === "button" && node.props.disabled === true && text(node).startsWith("Rolling back"));
    expect(button).toBeDefined(); expect(calls).toEqual([]);
    hooks.props = { ...hooks.props, rollbackBusy: false }; hooks.render();
    rollback(hooks)[0].props.onClick(); expect(calls).toEqual([digest("b")]);
  });
  it("selection becoming current immediately hides old diff and rollback", async () => {
    const { hooks } = await readyA(); hooks.props = { ...hooks.props, model: model("a") }; hooks.render();
    expect(text(hooks.tree)).not.toContain("Showing "); expect(rollback(hooks)).toHaveLength(0);
  });
  it.each(["null model", "empty history"])("%s hides ready comparison and late completion safely", async kind => {
    const { hooks, calls } = await start();
    const next = kind === "null model" ? null : { ...model(), history: [] };
    hooks.props = { ...hooks.props, model: next }; hooks.render();
    expect(text(hooks.tree)).toContain("No persisted World history is available");
    expect(rollback(hooks)).toHaveLength(0);
    await resolve(request("a"), model("a")); hooks.render();
    expect(text(hooks.tree)).not.toContain("Showing "); expect(rollback(hooks)).toHaveLength(0);
    hooks.flushEffects(); await ticks(); hooks.render(); expect(calls).toEqual([]);
  });
  it("history replacement invalidates ready rows before default-selection effect", async () => {
    const { hooks } = await readyA();
    const next = model(); next.history = next.history.filter(entry => entry.manifestDigest !== digest("a"));
    hooks.props = { ...hooks.props, model: next }; hooks.render(); safePending(hooks);
    hooks.flushEffects().render(); safePending(hooks); hooks.flushEffects(); await ticks();
    await resolve(request("b"), model("b")); hooks.render(); expect(rollback(hooks)).toHaveLength(1);
  });
  it("late authentication and fetch from superseded A cannot replace ready B", async () => {
    const session = deferred<AuthResult>(); runtime.session = session.promise;
    const { hooks, calls } = await start(); expect(requests).toHaveLength(0);
    select(hooks, "b"); safePending(hooks); runtime.session = null;
    hooks.flushEffects(); await ticks(); await resolve(request("b"), model("b")); hooks.render();
    session.resolve({ data: { session: { access_token: "synthetic-token" } } }); await ticks();
    await resolve(request("a"), model("a", "synthetic-world", "LATE AUTH A")); hooks.render();
    expect(text(hooks.tree)).not.toContain("LATE AUTH A");
    rollback(hooks)[0].props.onClick(); expect(calls).toEqual([digest("b")]);
  });
});
