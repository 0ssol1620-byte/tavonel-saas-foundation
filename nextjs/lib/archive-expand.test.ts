import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_LIMITS,
  expandArchive,
  MAX_SYNC_ARCHIVE_BYTES,
  MAX_WORKER_ARCHIVE_BYTES,
} from "./archive-expand";
import type { ArchiveExpander } from "./archive-client";
import { prepareWorkspaceSelection } from "./workspace-intake";

/*
  Expansion moved off the main thread, and what had to stay true while it moved.

  The guards are the reason this is a separate file rather than a change to the intake test:
  they now run in two places (a worker and the fallback) from one implementation, and the
  thing worth asserting is that the implementation is genuinely one.
*/

const archiveOf = (files: Record<string, Uint8Array>) => zipSync(files);
const bytes = (text: string) => new TextEncoder().encode(text);

describe("expanding an archive", () => {
  it("reports progress per entry, which is what makes a cancel button possible", () => {
    const seen: Array<[number, number]> = [];
    expandArchive(archiveOf({ "a.pdf": bytes("a"), "b.pdf": bytes("b"), "c.pdf": bytes("c") }), {
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("stops when the caller says stop, and does not return a half-expanded selection", () => {
    let calls = 0;
    expect(() => expandArchive(archiveOf({ "a.pdf": bytes("a"), "b.pdf": bytes("b") }), {
      isCancelled: () => {
        calls += 1;
        return calls > 1;
      },
    })).toThrow("ARCHIVE_CANCELLED");
  });

  it("still refuses a hostile archive before expanding anything", () => {
    expect(() => expandArchive(archiveOf({ "../escape.pdf": bytes("x") }))).toThrow("ARCHIVE_PATH_TRAVERSAL");
    expect(() => expandArchive(archiveOf({ "inner.zip": bytes("x") }))).toThrow("NESTED_ARCHIVE_NOT_ALLOWED");
    expect(() => expandArchive(bytes("not an archive at all"))).toThrow("ARCHIVE_DIRECTORY_MISSING");
  });
});

describe("where the expansion runs", () => {
  it("offers the larger ceiling only when something else will absorb it", () => {
    // The synchronous number describes what the main thread can do without stalling. Offering
    // the worker's ceiling on the fallback path would mean promising a limit and freezing.
    expect(MAX_WORKER_ARCHIVE_BYTES).toBeGreaterThan(MAX_SYNC_ARCHIVE_BYTES);
    expect(ARCHIVE_LIMITS.maxSyncArchiveMb).toBe(MAX_SYNC_ARCHIVE_BYTES / (1024 * 1024));
    expect(ARCHIVE_LIMITS.maxArchiveMb).toBe(MAX_WORKER_ARCHIVE_BYTES / (1024 * 1024));
  });

  it("uses the injected expander rather than opening the archive here", async () => {
    const expand = vi.fn(async () => ({
      mode: "worker" as const,
      entries: [{ path: "deck.pptx", bytes: new Uint8Array([1]) as Uint8Array<ArrayBuffer> }],
    }));
    const expander: ArchiveExpander = {
      ceilingBytes: MAX_WORKER_ARCHIVE_BYTES,
      mode: "worker",
      expand,
      close: () => undefined,
    };
    const archive = new File([archiveOf({ "deck.pptx": bytes("x") })], "corpus.zip");
    const result = await prepareWorkspaceSelection([archive], { expander });
    expect(expand).toHaveBeenCalledOnce();
    expect(result.files.map((entry) => entry.relativePath)).toEqual(["deck.pptx"]);
  });

  it("holds an archive to the ceiling of the path that will actually expand it", async () => {
    const oversize = new File([new Uint8Array(1)], "big.zip");
    Object.defineProperty(oversize, "size", { value: MAX_SYNC_ARCHIVE_BYTES + 1 });
    // No expander: the fallback runs here, so the smaller ceiling applies.
    await expect(prepareWorkspaceSelection([oversize])).rejects.toThrow("ARCHIVE_TOO_LARGE");
  });

  it("lets a selection be abandoned without uploading anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const archive = new File([archiveOf({ "a.pdf": bytes("a") })], "corpus.zip");
    await expect(prepareWorkspaceSelection([archive], { signal: controller.signal }))
      .rejects.toThrow("SELECTION_CANCELLED");
  });
});
