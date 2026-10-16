import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfEvidenceViewer from "../components/pdf-evidence-viewer";

const viewer = readFileSync(resolve(import.meta.dirname, "../components/pdf-evidence-viewer.tsx"), "utf8");
const studio = readFileSync(resolve(import.meta.dirname, "../components/world-studio-ultimate.tsx"), "utf8");

describe("actual PDF evidence viewer", () => {
  it("renders the requested PDF.js page before exposing the bbox overlay", () => {
    expect(viewer).toContain('import("pdfjs-dist")');
    expect(viewer).toContain("await activeRender.promise");
    expect(viewer).toContain('state === "ready"');
    expect(viewer).toContain("bbox[0] / 10");
    expect(viewer).toContain("renderTask?.cancel()");
  });

  it("exposes a named group, polite status and named page image while hiding the decorative bbox overlay", () => {
    expect(viewer).toContain('role="group" aria-label={label}');
    expect(viewer).toContain('<span role="status">');
    expect(viewer).toContain('role="img" aria-label={`${label}, page ${page}, evidence bounding box ${bbox.join(", ")}`}');
    expect(viewer).toMatch(/<i\s+aria-hidden="true"\s+data-evidence-bbox=""/);
  });

  it("replaces the browser PDF iframe in the persisted World evidence surface", () => {
    expect(studio).toContain("<PdfEvidenceViewer");
    expect(studio).not.toContain("<iframe");
  });
});

/*
  Render interruption. The installed Vitest runs in `node` with no DOM library, so the real component is
  driven by a minimal hook renderer -- state, refs, then layout and passive effects in React's commit
  order -- against a deferred fake of PDF.js and a canvas whose bitmap resets when it is resized, as a
  real one does. Every committed state is recorded, which is what lets a test say "never" rather than
  "not at the end". Pixels are labels ("doc-a:p2"), not images.
*/
type FakeCanvas = {
  bitmap: string | null;
  width: number;
  height: number;
  style: Record<string, string>;
  ownerDocument: { createElement: (tag: string) => FakeCanvas };
  getContext: (kind: string, options?: unknown) => { drawImage: (source: FakeCanvas) => void };
};
type FakeRender = { source: string; page: number; cancelled: boolean; late: boolean; finish: () => void; fail: (error: Error) => void };
type HostElement = { type: string; props: Record<string, unknown> };
type ViewerProps = Parameters<typeof PdfEvidenceViewer>[0];
type Observation = { state: unknown; image: unknown; overlay: string | null; status: unknown; pixels: string | null };

const hooks = vi.hoisted(() => {
  type Effect = {
    phase: "layout" | "passive";
    deps?: readonly unknown[];
    nextDeps?: readonly unknown[];
    run: (() => void | (() => void)) | null;
    cleanup: void | (() => void);
  };
  class Instance {
    slots: unknown[] = [];
    effects: Effect[] = [];
    cursor = 0;
    dirty = false;
    mounted = true;
    updatesAfterUnmount = 0;
    slot<T>(create: () => T): T {
      if (this.cursor === this.slots.length) this.slots.push(create());
      return this.slots[this.cursor++] as T;
    }
    // One commit phase in React's order: every changed effect is cleaned up first, then each one runs.
    flush(phase: Effect["phase"]) {
      const due = this.effects.filter(effect => effect.phase === phase && effect.run);
      for (const effect of due) if (typeof effect.cleanup === "function") effect.cleanup();
      for (const effect of due) {
        const run = effect.run;
        effect.run = null;
        effect.deps = effect.nextDeps;
        effect.cleanup = run?.();
      }
    }
    unmount() {
      if (!this.mounted) return;
      this.mounted = false;
      for (const effect of this.effects) if (typeof effect.cleanup === "function") effect.cleanup();
    }
  }
  let rendering: Instance | null = null;
  const current = () => {
    if (!rendering) throw new Error("hook called outside a harness render");
    return rendering;
  };
  const changed = (previous?: readonly unknown[], next?: readonly unknown[]) =>
    !previous || !next || previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
  const effectHook = (phase: Effect["phase"]) => (run: () => void | (() => void), deps?: readonly unknown[]) => {
    const instance = current();
    const effect = instance.slot<Effect>(() => {
      const created: Effect = { phase, run: null, cleanup: undefined };
      instance.effects.push(created);
      return created;
    });
    if (!changed(effect.deps, deps)) return;
    effect.run = run;
    effect.nextDeps = deps;
  };
  return {
    Instance,
    render<P>(instance: Instance, component: (props: P) => unknown, props: P) {
      rendering = instance;
      instance.cursor = 0;
      instance.dirty = false;
      try {
        return component(props);
      } finally {
        rendering = null;
      }
    },
    useState<T>(initial: T) {
      const instance = current();
      const cell = instance.slot(() => {
        const created: { value: T; set: (next: T) => void } = {
          value: initial,
          set: next => {
            if (!instance.mounted) {
              instance.updatesAfterUnmount += 1;
              return;
            }
            if (Object.is(next, created.value)) return;
            created.value = next;
            instance.dirty = true;
          },
        };
        return created;
      });
      return [cell.value, cell.set] as const;
    },
    useRef<T>(initial: T) {
      return current().slot(() => ({ current: initial }));
    },
    useEffect: effectHook("passive"),
    useLayoutEffect: effectHook("layout"),
  };
});

const pdf = vi.hoisted(() => {
  const loads: Array<{ source: string; destroyed: boolean; open: () => void }> = [];
  const renders: FakeRender[] = [];
  const options = { holdLoads: false };
  const api = {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument({ data }: { data: Uint8Array }) {
      const source = new TextDecoder().decode(data);
      let open!: () => void;
      const opened = new Promise<void>(resolve => { open = resolve; });
      const load = { source, destroyed: false, open };
      loads.push(load);
      if (!options.holdLoads) open();
      const page = (pageNumber: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 200 * scale }),
        render({ canvas }: { canvas: FakeCanvas }) {
          let resolve!: () => void;
          let reject!: (error: Error) => void;
          const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
          const render: FakeRender = {
            source,
            page: pageNumber,
            cancelled: false,
            late: false,
            // PDF.js stops painting once a task is cancelled; a `late` task models a result already on its way back.
            finish: () => {
              if (render.cancelled && !render.late) return;
              canvas.bitmap = `${source}:p${pageNumber}`;
              resolve();
            },
            fail: error => reject(error),
          };
          renders.push(render);
          return {
            promise,
            cancel: () => {
              render.cancelled = true;
              if (!render.late) reject(Object.assign(new Error("Rendering cancelled"), { name: "RenderingCancelledException" }));
            },
          };
        },
      });
      return {
        promise: opened.then(() => ({ numPages: 2, getPage: async (pageNumber: number) => page(pageNumber) })),
        destroy: async () => {
          load.destroyed = true;
        },
      };
    },
  };
  return {
    api,
    loads,
    renders,
    options,
    reset() {
      loads.length = 0;
      renders.length = 0;
      options.holdLoads = false;
    },
  };
});

vi.mock("react", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useEffect: hooks.useEffect,
  useLayoutEffect: hooks.useLayoutEffect,
}));
vi.mock("pdfjs-dist", () => pdf.api);

function fakeCanvas(): FakeCanvas {
  let width = 300;
  let height = 150;
  const canvas: FakeCanvas = {
    bitmap: null,
    style: {},
    // Assigning either dimension clears the bitmap, as on a real canvas.
    get width() { return width; },
    set width(value) { width = value; canvas.bitmap = null; },
    get height() { return height; },
    set height(value) { height = value; canvas.bitmap = null; },
    ownerDocument: { createElement: () => fakeCanvas() },
    getContext: () => ({ drawImage: source => { canvas.bitmap = source.bitmap; } }),
  };
  return canvas;
}

const evidence = (source: string, page: number, bbox: ViewerProps["bbox"]): ViewerProps => ({
  data: new TextEncoder().encode(source),
  page,
  bbox,
  label: `Source ${source}, page ${page}, exact evidence region`,
});
const older = evidence("doc-a", 2, [100, 200, 900, 300]);
const newer = evidence("doc-b", 1, [250, 500, 750, 900]);
// Another page of the very same bytes: the viewer is handed one `data` across page changes.
const olderPageOne: ViewerProps = { ...evidence("doc-a", 1, [400, 100, 600, 200]), data: older.data };
const waiting: Observation = { state: "loading", image: null, overlay: null, status: "Rendering source page…", pixels: null };
const unavailable: Observation = { state: "unavailable", image: null, overlay: null, status: "Source page unavailable", pixels: null };

function drawn({ data, page, bbox, label }: ViewerProps): Observation {
  return {
    state: "ready",
    image: `${label}, page ${page}, evidence bounding box ${bbox.join(", ")}`,
    overlay: [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]].map(value => `${value / 10}%`).join(" "),
    status: null,
    pixels: `${new TextDecoder().decode(data)}:p${page}`,
  };
}

function observe(tree: HostElement, canvas: FakeCanvas): Observation {
  const [image, marker] = tree.props.children as [HostElement, HostElement];
  const style = marker.props.style as Record<string, string>;
  return {
    state: tree.props["data-state"],
    image: image.props["aria-hidden"] ? null : image.props["aria-label"],
    // The e2e suite finds the overlay by `data-evidence-bbox`; it must stay decorative (aria-hidden).
    overlay: marker.type === "i" && marker.props["data-evidence-bbox"] === "" && marker.props["aria-hidden"] === "true"
      ? ["left", "top", "width", "height"].map(edge => style[`--bbox-${edge}`]).join(" ") : null,
    status: marker.type === "span" ? marker.props.children : null,
    pixels: canvas.bitmap,
  };
}

// After a change nothing that identifies the superseded evidence is committed, and nothing is exposed --
// "ready", an image name, an overlay or pixels -- until it is exactly `outcome`.
function expectOnly(timeline: Observation[], outcome: Observation, superseded: Observation) {
  for (const seen of timeline) {
    expect(seen.pixels).not.toBe(superseded.pixels);
    expect(seen.image).not.toBe(superseded.image);
    expect(seen.overlay).not.toBe(superseded.overlay);
    if (seen.state !== "loading" || seen.image !== null || seen.overlay !== null || seen.pixels !== null) expect(seen).toEqual(outcome);
  }
}

const drain = () => new Promise(resolve => setTimeout(resolve, 0));
// The viewer's ResizeObserver callback, so a test can change the measured width as the browser would.
let resizeCallback: (() => void) | undefined;
let unmountMounted: (() => void) | undefined;

function mountViewer(initial: ViewerProps) {
  const instance = new hooks.Instance();
  const canvas = fakeCanvas();
  const container = { clientWidth: 400 };
  const timeline: Observation[] = [];
  let props = initial;
  let tree!: HostElement;
  const commit = () => {
    tree = hooks.render(instance, PdfEvidenceViewer, props) as HostElement;
    const [image] = tree.props.children as [HostElement];
    // React attaches the same host nodes on every commit, before layout effects run.
    (tree.props.ref as { current: unknown }).current = container;
    (image.props.ref as { current: unknown }).current = canvas;
    instance.flush("layout");
    timeline.push(observe(tree, canvas));
    instance.flush("passive");
  };
  const settle = () => {
    commit();
    for (let renders = 1; instance.dirty; renders += 1) {
      if (renders > 10) throw new Error("render loop");
      commit();
    }
  };
  settle();
  unmountMounted = () => instance.unmount();
  return {
    timeline,
    /** Commits new props and returns the index where their committed states start. */
    update(next: ViewerProps) {
      const from = timeline.length;
      props = next;
      settle();
      return from;
    },
    /** Lets settled PDF.js promises run, then records what is on screen, committing any state they set. */
    async flush() {
      await drain();
      if (instance.dirty) settle();
      else timeline.push(observe(tree, canvas));
      return timeline.at(-1);
    },
    /** Changes the container width and fires the ResizeObserver, committing the new measurement. */
    resize(width: number) {
      const from = timeline.length;
      container.clientWidth = width;
      resizeCallback?.();
      settle();
      return from;
    },
    unmount: () => instance.unmount(),
    updatesAfterUnmount: () => instance.updatesAfterUnmount,
  };
}

describe("PDF evidence viewer render interruption (deferred PDF.js fake, no DOM)", () => {
  const rendering = (count: number) => vi.waitFor(() => expect(pdf.renders).toHaveLength(count), { timeout: 5000 });
  const complete = (render: FakeRender, result: "succeeds" | "fails") => (result === "succeeds" ? render.finish() : render.fail(new Error("PDF_RENDER_FAILED")));

  beforeEach(() => {
    pdf.reset();
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizeCallback = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    unmountMounted?.();
    unmountMounted = undefined;
    vi.unstubAllGlobals();
  });

  it.each([["source", newer], ["page", olderPageOne]] as const)(
    "a %s change hides the older page, overlay and image name until the newer page is drawn",
    async (_change: string, next: ViewerProps) => {
      const view = mountViewer(older);
      await rendering(1);
      pdf.renders[0].finish();
      expect(await view.flush()).toEqual(drawn(older));
      const from = view.update(next);
      expect(view.timeline.at(-1)).toEqual(waiting);
      expect(pdf.loads[0].destroyed).toBe(true);
      await rendering(2);
      pdf.renders[1].finish();
      expect(await view.flush()).toEqual(drawn(next));
      expectOnly(view.timeline.slice(from), drawn(next), drawn(older));
    },
  );

  it.each([["succeeds", "succeeds"], ["succeeds", "fails"], ["fails", "succeeds"], ["fails", "fails"]] as const)(
    "when the newer render %s and the superseded render then %s, only the newer outcome is shown",
    async (newerResult: "succeeds" | "fails", supersededResult: "succeeds" | "fails") => {
      const view = mountViewer(older);
      await rendering(1);
      const superseded = pdf.renders[0];
      superseded.late = true; // its cancellation reaches PDF.js too late to stop it
      const from = view.update(newer);
      expect(superseded.cancelled).toBe(true);
      expect(pdf.loads[0].destroyed).toBe(true);
      await rendering(2);
      complete(pdf.renders[1], newerResult);
      const outcome = newerResult === "succeeds" ? drawn(newer) : unavailable;
      expect(await view.flush()).toEqual(outcome);
      complete(superseded, supersededResult);
      expect(await view.flush()).toEqual(outcome);
      expectOnly(view.timeline.slice(from), outcome, drawn(older));
    },
  );

  /*
    Scrollbar flapping: 400 -> 385 -> 400 before the page is redrawn at 400.

    Each request is driven through explicit deferreds, never through timing. Vitest 3.2's factory
    mock tracks an in-flight `import("pdfjs-dist")` on the importer's shared callstack, so a second
    import from the viewer that starts while the first is still resolving bypasses the mock and
    loads the real PDF.js (CI: "Please use the legacy build", then a hang). So the 385 request is
    held at `getDocument` -- its import settled -- before the width returns to 400.
  */
  it("returning to an earlier width never revives that width's finished render over the wiped canvas", async () => {
    const loaded = (count: number) => vi.waitFor(() => expect(pdf.loads).toHaveLength(count), { timeout: 2000 });
    const view = mountViewer(older);
    await loaded(1);
    await vi.waitFor(() => expect(pdf.renders).toHaveLength(1), { timeout: 2000 });
    const first = pdf.renders[0];
    first.finish();
    expect(await view.flush()).toEqual(drawn(older));

    pdf.options.holdLoads = true;
    view.resize(385);
    expect(view.timeline.at(-1)).toEqual(waiting);
    await loaded(2); // the 385 request has imported PDF.js and is parked on its document

    const from = view.resize(400);
    expect(pdf.loads[1].destroyed).toBe(true);
    // The canvas was wiped for 385; nothing may claim the 400 page is on screen until it is redrawn.
    for (const seen of view.timeline.slice(from)) expect(seen).toEqual(waiting);
    expect(await view.flush()).toEqual(waiting);

    await loaded(3);
    const redraw = pdf.loads[2];
    redraw.open();
    let render: FakeRender | undefined;
    await vi.waitFor(() => {
      render = pdf.renders.find(candidate => candidate !== first);
      expect(render).toBeDefined();
    }, { timeout: 2000 });
    expect(view.timeline.at(-1)).toEqual(waiting);
    render!.finish();
    expect(await view.flush()).toEqual(drawn(older));
  });

  it("unmounting while the document loads destroys the loading task and never renders", async () => {
    pdf.options.holdLoads = true;
    const view = mountViewer(older);
    await vi.waitFor(() => expect(pdf.loads).toHaveLength(1), { timeout: 5000 });
    view.unmount();
    expect(pdf.loads[0].destroyed).toBe(true);
    pdf.loads[0].open();
    await drain();
    expect(pdf.renders).toHaveLength(0);
    expect(view.updatesAfterUnmount()).toBe(0);
  });

  it("unmounting mid-render cancels PDF.js, and a late result never updates the viewer", async () => {
    const view = mountViewer(older);
    await rendering(1);
    pdf.renders[0].late = true;
    view.unmount();
    expect(pdf.renders[0].cancelled).toBe(true);
    expect(pdf.loads[0].destroyed).toBe(true);
    pdf.renders[0].finish();
    await drain();
    expect(view.updatesAfterUnmount()).toBe(0);
  });
});
