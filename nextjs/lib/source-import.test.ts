/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveFoundationIntake = vi.fn<(...args: any[]) => Promise<any>>();
const reserveFoundationCompute = vi.fn<(...args: any[]) => Promise<any>>();
const confirmFoundationIntake = vi.fn<(...args: any[]) => Promise<any>>();
const presignFoundationQuarantinePut = vi.fn<(...args: any[]) => any>();
const recordConnectorDocumentBinding = vi.fn<(...args: any[]) => Promise<any>>();
vi.mock("./connector-binding-store", () => ({ recordConnectorDocumentBinding }));

vi.mock("./intake-admission", () => ({ confirmFoundationIntake, reserveFoundationIntake }));
vi.mock("./compute-reservation", () => ({ reserveFoundationCompute }));
vi.mock("./r2-presign", () => ({
  FOUNDATION_INTAKE_MAX_BYTES: 5 * 1024 * 1024,
  presignFoundationQuarantinePut,
}));

const { importSourceObject } = await import("./source-import");

beforeEach(() => {
  vi.clearAllMocks();
  recordConnectorDocumentBinding.mockResolvedValue({ ok: true });
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
  it.each([false, true])("binds a Dropbox revision before intake (matching=%s)", async matching => {
    const bytes = new TextEncoder().encode("abc");
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { headers: {
      "Dropbox-API-Result": JSON.stringify({ id: "id:file", rev: matching ? "a1c10ce0dd78" : "newer", size: 3,
        content_hash: "4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358" }),
    } }));
    const result = await importSourceObject({ workspaceKey: "pilot-acme01", userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222", provider: "dropbox", accessToken: "access", target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetcher },
    { nativeId: "id:file", name: "file.pdf", revision: "a1c10ce0dd78", mimeType: "application/pdf", sizeBytes: 3, modifiedAt: null, kind: "file" });
    expect(JSON.parse(fetcher.mock.calls[0][1].headers.get("Dropbox-API-Arg"))).toEqual({ path: "rev:a1c10ce0dd78" });
    expect(result.ok).toBe(matching);
    if (matching) expect(recordConnectorDocumentBinding).toHaveBeenCalledOnce();
    else {
      expect(result).toMatchObject({ code: "SOURCE_REVISION_MISMATCH" });
      expect(recordConnectorDocumentBinding).not.toHaveBeenCalled();
      expect(reserveFoundationIntake).not.toHaveBeenCalled();
    }
  });
  it("does not admit or upload a source whose stream fails", async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("connection closed")); },
    }))) as unknown as typeof fetch;
    const result = await importSourceObject({
      workspaceKey: "pilot-acme01", userId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222", provider: "google_drive",
      accessToken: "access", target: {},
      signer: { accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetcher,
    }, { nativeId: "file", name: "file.pdf", revision: "v1", mimeType: "application/pdf",
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
      fetcher,
    }, {
      nativeId: "drive-file",
      name: "Paper.pdf",
      revision: "revision-1",
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
      fetcher,
    }, {
      nativeId: "drive-file",
      name: "Paper.pdf",
      revision: "revision-2",
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
