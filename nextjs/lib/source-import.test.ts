/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveFoundationIntake = vi.fn<(...args: any[]) => Promise<any>>();
const reserveFoundationCompute = vi.fn<(...args: any[]) => Promise<any>>();
const confirmFoundationIntake = vi.fn<(...args: any[]) => Promise<any>>();
const presignFoundationQuarantinePut = vi.fn<(...args: any[]) => any>();
const recordConnectorDocumentBinding = vi.fn<(...args: any[]) => Promise<any>>();
const readConnectorLatestBinding = vi.fn<(...args: any[]) => Promise<any>>();
const canAdmitCustomerSource = vi.fn<(...args: any[]) => Promise<boolean>>();
vi.mock("./connector-binding-store", () => ({ readConnectorLatestBinding, recordConnectorDocumentBinding }));
vi.mock("./customer-data-admission", () => ({ canAdmitCustomerSource }));

vi.mock("./intake-admission", () => ({ confirmFoundationIntake, reserveFoundationIntake }));
vi.mock("./compute-reservation", () => ({ reserveFoundationCompute }));
vi.mock("./r2-presign", () => ({
  FOUNDATION_INTAKE_MAX_BYTES: 5 * 1024 * 1024,
  presignFoundationQuarantinePut,
}));

const { importSourceObject } = await import("./source-import");

function withGoogleMetadata(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.searchParams.has("fields")) return Response.json({ id: url.pathname.split("/").at(-1), version: "1",
      mimeType: "application/pdf", size: "3", md5Checksum: "5289df737df57326fcdd22597afb1fac", capabilities: { canDownload: true } });
    return fetcher(input, init);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canAdmitCustomerSource.mockResolvedValue(true);
  recordConnectorDocumentBinding.mockResolvedValue({ ok: true });
  readConnectorLatestBinding.mockResolvedValue({ ok: true, sourceVersionId: null });
  reserveFoundationIntake.mockResolvedValue({
    ok: true,
    result: {
      documentId: "existing",
      objectKey: "existing",
      expiresAt: "2026-09-01T00:00:00Z",
      idempotentReplay: true,
    },
  });
  reserveFoundationCompute.mockResolvedValue({ ok: true, result: {} });
  confirmFoundationIntake.mockResolvedValue({ ok: true, result: {} });
  presignFoundationQuarantinePut.mockReturnValue({ ok: true, uploadUrl: "https://r2.example/upload" });
});

describe("source import replay safety", () => {
  it("does not read provider bytes or reserve intake after workspace approval is revoked", async () => {
    canAdmitCustomerSource.mockResolvedValue(false);
    const fetcher = vi.fn();
    const result = await importSourceObject({ workspaceKey: "pilot-acme01", userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222", provider: "google_drive", accessToken: "access", target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetcher },
    { nativeId: "file", name: "file.pdf", revision: "1", mimeType: "application/pdf", sizeBytes: 3, modifiedAt: null, kind: "file" });
    expect(result).toEqual({ ok: false, nativeId: "file", code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(canAdmitCustomerSource).toHaveBeenCalledWith("pilot-acme01", "connector");
    expect(fetcher).not.toHaveBeenCalled();
    expect(reserveFoundationIntake).not.toHaveBeenCalled();
  });
  it("refuses a Google change during download before source binding or intake", async () => {
    const metadata = { id: "file", version: "1", mimeType: "application/pdf", size: "3",
      md5Checksum: "900150983cd24fb0d6963f7d28e17f72", capabilities: { canDownload: true } };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode("abc")))
      .mockResolvedValueOnce(Response.json({ ...metadata, version: "2" }));
    const result = await importSourceObject({ workspaceKey: "pilot-acme01", userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222", provider: "google_drive", accessToken: "access", target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetcher },
    { nativeId: "file", name: "file.pdf", revision: "1", mimeType: "application/pdf", sizeBytes: 3, modifiedAt: null, kind: "file" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_REVISION_MISMATCH" });
    expect(recordConnectorDocumentBinding).not.toHaveBeenCalled();
    expect(reserveFoundationIntake).not.toHaveBeenCalled();
    expect(reserveFoundationCompute).not.toHaveBeenCalled();
  });
  // Synthetic responses shaped by Dropbox's documented `files/get_metadata` and `files/download` contracts.
  const ABC_HASH = "4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358";
  const dropboxFile = (rev: string) => ({ ".tag": "file", id: "id:file", name: "file.pdf", rev, size: 3, content_hash: ABC_HASH, is_downloadable: true });
  function dropbox(currentRevs: Array<string | Response>, downloadRev = "a1c10ce0dd78") {
    const metadata = [...currentRevs];
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.dropboxapi.com/2/files/get_metadata") {
        const next = metadata.shift();
        if (next === undefined) throw new Error("unexpected metadata read");
        return typeof next === "string" ? Response.json(dropboxFile(next)) : next;
      }
      if (url === "https://content.dropboxapi.com/2/files/download") return new Response(new TextEncoder().encode("abc"), { headers: {
        "Dropbox-API-Result": JSON.stringify({ id: "id:file", rev: downloadRev, size: 3, content_hash: ABC_HASH }) } });
      throw new Error(`unexpected request ${url}`);
    });
  }
  const importDropbox = (fetcher: ReturnType<typeof dropbox>) => importSourceObject({ workspaceKey: "pilot-acme01", userId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222", provider: "dropbox", accessToken: "access", target: {},
    signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetcher: fetcher as unknown as typeof fetch },
  { nativeId: "id:file", name: "file.pdf", revision: "a1c10ce0dd78", mimeType: "application/pdf", sizeBytes: 3, modifiedAt: null, kind: "file" });
  const expectNothingBound = () => {
    expect(recordConnectorDocumentBinding).not.toHaveBeenCalled();
    expect(reserveFoundationIntake).not.toHaveBeenCalled();
    expect(reserveFoundationCompute).not.toHaveBeenCalled();
  };

  it("binds a Dropbox revision that is current before and after its pinned download", async () => {
    const fetcher = dropbox(["a1c10ce0dd78", "a1c10ce0dd78"]);
    const result = await importDropbox(fetcher);
    expect(result.ok).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["https://api.dropboxapi.com/2/files/get_metadata",
      "https://content.dropboxapi.com/2/files/download", "https://api.dropboxapi.com/2/files/get_metadata"]);
    const [, metadataInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(metadataInit.body))).toEqual({ path: "id:file", include_deleted: false });
    const [, downloadInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse((downloadInit.headers as Headers).get("Dropbox-API-Arg")!)).toEqual({ path: "rev:a1c10ce0dd78" });
    expect(recordConnectorDocumentBinding).toHaveBeenCalledOnce();
    expect(recordConnectorDocumentBinding.mock.calls[0][0]).toMatchObject({ provider: "dropbox", nativeId: "id:file", revision: "a1c10ce0dd78" });
  });
  it("snapshots the latest binding before any provider read and records against it", async () => {
    const order: string[] = [];
    const latest = `sv-${"c".repeat(64)}`;
    readConnectorLatestBinding.mockImplementation(async () => { order.push("snapshot"); return { ok: true, sourceVersionId: latest }; });
    const provider = dropbox(["a1c10ce0dd78", "a1c10ce0dd78"]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { order.push(String(input)); return provider(input); });
    expect((await importDropbox(fetcher as unknown as ReturnType<typeof dropbox>)).ok).toBe(true);
    expect(order[0]).toBe("snapshot");
    expect(readConnectorLatestBinding.mock.calls[0][0]).toMatchObject({ provider: "dropbox", nativeId: "id:file", revision: "a1c10ce0dd78" });
    expect(recordConnectorDocumentBinding.mock.calls[0][0]).toMatchObject({ expectedLatestSourceVersionId: latest });
  });
  it("reads no provider bytes when the latest binding cannot be read", async () => {
    readConnectorLatestBinding.mockResolvedValue({ ok: false, code: "CONNECTOR_BINDING_READ_FAILED" });
    const fetcher = dropbox([]);
    expect(await importDropbox(fetcher)).toMatchObject({ ok: false, code: "CONNECTOR_BINDING_READ_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
    expectNothingBound();
  });
  it("admits nothing when another revision was bound after the snapshot", async () => {
    recordConnectorDocumentBinding.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" });
    expect(await importDropbox(dropbox(["a1c10ce0dd78", "a1c10ce0dd78"]))).toMatchObject({ ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" });
    expect(reserveFoundationIntake).not.toHaveBeenCalled();
    expect(reserveFoundationCompute).not.toHaveBeenCalled();
  });
  it("refuses a pinned download whose result names another revision", async () => {
    const result = await importDropbox(dropbox(["a1c10ce0dd78", "a1c10ce0dd78"], "newer"));
    expect(result).toMatchObject({ ok: false, code: "SOURCE_REVISION_MISMATCH" });
    expectNothingBound();
  });
  it("refuses a stale listed Dropbox revision before downloading it", async () => {
    const fetcher = dropbox(["b2d20ce0dd79"]);
    const result = await importDropbox(fetcher);
    expect(result).toMatchObject({ ok: false, code: "SOURCE_REVISION_SUPERSEDED" });
    expect(fetcher).toHaveBeenCalledOnce();
    expectNothingBound();
  });
  it("refuses a Dropbox revision superseded during its download", async () => {
    const result = await importDropbox(dropbox(["a1c10ce0dd78", "b2d20ce0dd79"]));
    expect(result).toMatchObject({ ok: false, code: "SOURCE_REVISION_SUPERSEDED" });
    expectNothingBound();
  });
  it.each([
    ["deleted before download", [Response.json({ error_summary: "path/not_found/.", error: { ".tag": "path", path: { ".tag": "not_found" } } }, { status: 409 })], "SOURCE_REVISION_SUPERSEDED"],
    ["deleted during download", ["a1c10ce0dd78", Response.json({ error_summary: "path/not_found/.", error: { ".tag": "path", path: { ".tag": "not_found" } } }, { status: 409 })], "SOURCE_REVISION_SUPERSEDED"],
    ["unreadable metadata", [new Response("unavailable", { status: 503 })], "SOURCE_VERSION_READ_FAILED"],
    ["other path error", [Response.json({ error_summary: "path/restricted_content/.", error: { ".tag": "path", path: { ".tag": "restricted_content" } } }, { status: 409 })], "SOURCE_VERSION_READ_FAILED"],
  ] as const)("fails closed when the Dropbox file is %s", async (_label, responses, code) => {
    const result = await importDropbox(dropbox([...responses]));
    expect(result).toMatchObject({ ok: false, code });
    expectNothingBound();
  });
  it("does not admit or upload a source whose stream fails", async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("connection closed")); },
    }))) as unknown as typeof fetch;
    const result = await importSourceObject({
      workspaceKey: "pilot-acme01", userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222", provider: "google_drive",
      accessToken: "access", target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetcher: withGoogleMetadata(fetcher),
    }, { nativeId: "file", name: "file.pdf", revision: "1", mimeType: "application/pdf",
      sizeBytes: null, modifiedAt: null, kind: "file" });
    expect(result).toEqual({ ok: false, nativeId: "file", code: "SOURCE_DOWNLOAD_FAILED" });
    expect(reserveFoundationIntake).not.toHaveBeenCalled();
    expect(reserveFoundationCompute).not.toHaveBeenCalled();
    expect(presignFoundationQuarantinePut).not.toHaveBeenCalled();
  });

  it("does not reserve compute or overwrite R2 for an admitted revision", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })) as unknown as typeof fetch;

    const outcome = await importSourceObject({
      workspaceKey: "pilot-acme01",
      userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      provider: "google_drive",
      accessToken: "access",
      target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" },
      fetcher: withGoogleMetadata(fetcher),
    }, {
      nativeId: "drive-file",
      name: "Paper.pdf",
      revision: "1",
      mimeType: "application/pdf",
      sizeBytes: 3,
      modifiedAt: null,
      kind: "file",
    });

    expect(outcome.ok).toBe(true);
    expect(recordConnectorDocumentBinding).toHaveBeenCalledOnce();
    expect(reserveFoundationCompute).not.toHaveBeenCalled();
    expect(presignFoundationQuarantinePut).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("confirms a fresh admission only after the quarantine PUT succeeds", async () => {
    reserveFoundationIntake.mockResolvedValue({
      ok: true,
      result: {
        documentId: "fresh",
        objectKey: "fresh",
        expiresAt: "2026-09-01T00:00:00Z",
        idempotentReplay: false,
        confirmed: false,
      },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })) as unknown as typeof fetch;

    const outcome = await importSourceObject({
      workspaceKey: "pilot-acme01",
      userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      provider: "google_drive",
      accessToken: "access",
      target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" },
      fetcher: withGoogleMetadata(fetcher),
    }, {
      nativeId: "drive-file",
      name: "Paper.pdf",
      revision: "1",
      mimeType: "application/pdf",
      sizeBytes: 3,
      modifiedAt: null,
      kind: "file",
    });

    expect(outcome.ok).toBe(true);
    expect(confirmFoundationIntake).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
