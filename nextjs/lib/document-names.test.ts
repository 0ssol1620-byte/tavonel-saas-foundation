import { beforeEach, describe, expect, it } from "vitest";
import { displayName, elideKey, recallDocumentNames, rememberDocumentName, shortHandle } from "./document-names";

/**
 * The two behaviours worth pinning are the two that failed in production: a document with no
 * remembered name printed a 36-character UUID, and a remembered name did not survive a reload.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const ID = "10fc3cfd-2cef-49f6-8ff5-7a2bb6ed360d";

beforeEach(() => {
  // @ts-expect-error -- a deliberate minimal stand-in for the one API this module touches.
  globalThis.window = { localStorage: new MemoryStorage() };
});

describe("what a document is called", () => {
  it("shortens an id to something a person can hold in their head", () => {
    expect(shortHandle(ID)).toBe("doc-10fc3cfd");
    // Never longer than the id it replaces, whatever it is handed.
    expect(shortHandle("").length).toBeLessThanOrEqual(4);
  });

  it("prefers the remembered filename, then a local one, then the handle", () => {
    expect(displayName(ID, { [ID]: "Services Agreement 2026.pdf" })).toBe("Services Agreement 2026.pdf");
    expect(displayName(ID, {}, "in-flight.pdf")).toBe("in-flight.pdf");
    expect(displayName(ID, {})).toBe("doc-10fc3cfd");
  });

  it("survives the reload that lost it before", () => {
    rememberDocumentName(ID, "Services Agreement 2026.pdf");
    // A fresh read, as a page load would do: nothing is held in module state.
    expect(recallDocumentNames()[ID]).toBe("Services Agreement 2026.pdf");
  });

  it("never breaks the workspace when storage refuses or holds junk", () => {
    // The shape a different app, or a corrupted entry, could leave behind.
    window.localStorage.setItem("tavonel.document-names.v1", "[not an object]");
    expect(recallDocumentNames()).toEqual({});

    // @ts-expect-error -- storage disabled entirely, as in a locked-down browser.
    globalThis.window.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    expect(recallDocumentNames()).toEqual({});
    expect(() => rememberDocumentName(ID, "x.pdf")).not.toThrow();
  });

  it("evicts the oldest entries rather than growing without limit", () => {
    for (let i = 0; i < 520; i += 1) rememberDocumentName(`id-${i}`, `file-${i}.pdf`);
    const names = recallDocumentNames();
    expect(Object.keys(names).length).toBe(500);
    expect(names["id-0"]).toBeUndefined();
    expect(names["id-519"]).toBe("file-519.pdf");
  });

  it("elides the middle of a receipt key and leaves both ends readable", () => {
    const key = "immutable/pilot-969dc192daa24119/pilot-969dc192daa24119/10fc3cfd-2cef-49f6-8ff5-7a2bb6ed360d/bb2827279c029d908e6bddbabb519dd6c6ae466e9e45158f23deaa4abff90a03/sanitized.pdf";
    const short = elideKey(key);
    expect(short.length).toBeLessThan(key.length);
    expect(short.startsWith("immutable/pilot-")).toBe(true);
    expect(short.endsWith("sanitized.pdf")).toBe(true);
    // A key that is already short is returned untouched rather than gaining an ellipsis.
    expect(elideKey("immutable/short.pdf")).toBe("immutable/short.pdf");
  });
});
