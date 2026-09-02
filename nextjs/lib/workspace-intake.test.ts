import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { collectDroppedWorkspaceFiles, prepareWorkspaceSelection } from "./workspace-intake";

describe("workspace intake preflight", () => {
  it("preserves safe archive hierarchy and reports unsupported files", async () => {
    const archive = zipSync({ "research/paper.pdf": new Uint8Array([1, 2]), "research/readme.exe": new Uint8Array([3]) });
    const result = await prepareWorkspaceSelection([new File([archive], "corpus.zip", { type: "application/zip" })]);
    expect(result.files.map((entry) => entry.relativePath)).toEqual(["research/paper.pdf"]);
    expect(result.files[0]?.file.name).toBe("research__paper.pdf");
    expect((result.files[0]?.file as File & { tavonelRelativePath?: string }).tavonelRelativePath).toBe("research/paper.pdf");
    expect(result.unsupported).toEqual(["research/readme.exe"]);
  });

  it("blocks traversal and nested archives before extraction", async () => {
    const traversal = zipSync({ "../secret.pdf": new Uint8Array([1]) });
    await expect(prepareWorkspaceSelection([new File([traversal], "bad.zip")])).rejects.toThrow("ARCHIVE_PATH_TRAVERSAL");
    const nested = zipSync({ "inside.zip": new Uint8Array([1]) });
    await expect(prepareWorkspaceSelection([new File([nested], "nested.zip")])).rejects.toThrow("NESTED_ARCHIVE_NOT_ALLOWED");
  });

  it("recursively collects a dropped folder across directory-reader batches", async () => {
    const fileEntry = (fullPath: string, file: File) => ({
      isFile: true as const,
      isDirectory: false as const,
      name: file.name,
      fullPath,
      file: (success: (value: File) => void) => success(file),
    });
    const batches = [[fileEntry("/research/a.pdf", new File(["a"], "a.pdf"))], [fileEntry("/research/deep/b.docx", new File(["b"], "b.docx"))], []];
    const directory = {
      isFile: false as const,
      isDirectory: true as const,
      name: "research",
      fullPath: "/research",
      createReader: () => ({ readEntries: (success: (entries: typeof batches[number]) => void) => success(batches.shift() ?? []) }),
    };
    const dropped = await collectDroppedWorkspaceFiles([{ getAsFile: () => null, webkitGetAsEntry: () => directory }]);
    const result = await prepareWorkspaceSelection(dropped);
    expect(result.files.map((entry) => entry.relativePath)).toEqual(["research/a.pdf", "research/deep/b.docx"]);
  });
});
