/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveFoundationIntake = vi.fn<(...args: any[]) => Promise<any>>();
const reserveFoundationCompute = vi.fn<(...args: any[]) => Promise<any>>();
const presignFoundationQuarantinePut = vi.fn<(...args: any[]) => any>();

vi.mock("./intake-admission", () => ({ reserveFoundationIntake }));
vi.mock("./compute-reservation", () => ({ reserveFoundationCompute }));
vi.mock("./r2-presign", () => ({
  FOUNDATION_INTAKE_MAX_BYTES: 5 * 1024 * 1024,
  presignFoundationQuarantinePut,
}));

const { importSourceObject } = await import("./source-import");

beforeEach(() => {
  vi.clearAllMocks();
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
  presignFoundationQuarantinePut.mockReturnValue({ ok: true, uploadUrl: "https://r2.example/upload" });
});

describe("source import replay safety", () => {
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
    expect(reserveFoundationCompute).not.toHaveBeenCalled();
    expect(presignFoundationQuarantinePut).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
