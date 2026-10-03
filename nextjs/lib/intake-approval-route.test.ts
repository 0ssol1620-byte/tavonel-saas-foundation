import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  authorize: vi.fn(), admit: vi.fn(), create: vi.fn(),
  fingerprint: vi.fn(), quote: vi.fn(),
}));

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: m.authorize }));
vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: "open" } } }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: m.admit }));
vi.mock("@/lib/compute-reservation", () => ({ createFoundationIntakeApproval: m.create, readFoundationIntakeApproval: vi.fn() }));
vi.mock("@/lib/usage-pricing", () => ({ intakePricingFingerprint: m.fingerprint, quoteIntakeManifest: m.quote }));

import { POST } from "../app/api/uploads/approval/route";
import { intakeManifestDigest, MAX_APPROVAL_METADATA_BYTES, type IntakeManifestEntry } from "./intake-approval";

const hash = `sha256:${"a".repeat(64)}`;
const attemptKey = "attempt_0123456789abcdef";
const fileKey = (index: number) => `fk_${String(index).padStart(8, "0")}`;

function manifest(count: number): IntakeManifestEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    fileKey: fileKey(index), originalFilename: `file-${index}.pdf`, contentSha256: hash,
    byteLength: 1024, mimeType: "application/pdf", claimedPages: 1, claimedBasis: "pdf_page_tree",
  }));
}

async function requestBody(files: ReturnType<typeof manifest>, maximum = files.length, digestOverride?: string) {
  return {
    attemptKey,
    clientManifestDigest: digestOverride ?? await intakeManifestDigest(files),
    pricingFingerprint: hash,
    aggregateMaximumCredits: maximum,
    files,
  };
}

async function request(files: ReturnType<typeof manifest>, maximum = files.length, digestOverride?: string) {
  return new Request("https://tavonel.com/api/uploads/approval", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(await requestBody(files, maximum, digestOverride)),
  });
}

beforeEach(() => {
  m.authorize.mockReset().mockResolvedValue({ ok: true, principal: { workspaceKey: "pilot-abc123", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", accessSource: "paid" } });
  m.admit.mockReset().mockResolvedValue(true);
  m.create.mockReset().mockResolvedValue({ ok: true, result: { approvalId: "11111111-1111-4111-8111-111111111111" } });
  m.fingerprint.mockReset().mockResolvedValue(hash);
  m.quote.mockReset().mockImplementation((entries: Array<unknown>) => ({
    ok: true,
    quote: {
      maximumPages: entries.length, reservedCredits: entries.length, maximumCredits: entries.length,
      estimatedUsd: entries.length / 100, maximumUsd: entries.length / 50,
      files: entries.map(() => ({ pageBasis: "measured", approvedMaxPages: 1, reservedCredits: 1, maximumCredits: 1 })),
    },
  }));
});

describe("approval route preserves one bounded complete selection", () => {
  it.each([1, 13, 20, 21, 128])("creates one server approval for %i files", async (count) => {
    const response = await POST(await request(manifest(count)));
    expect(response.status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0]![0].files).toHaveLength(count);
  });

  it("refuses 129 files before any approval or reservation call", async () => {
    const response = await POST(await request(manifest(129)));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "INTAKE_APPROVAL_INVALID" });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("refuses a deliberately mismatched manifest digest", async () => {
    const response = await POST(await request(manifest(1), 1, `sha256:${"b".repeat(64)}`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "INTAKE_APPROVAL_MANIFEST_MISMATCH" });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("bounds worst-case metadata independently of the 128-file count", async () => {
    const body = JSON.stringify({ attemptKey, clientManifestDigest: hash, pricingFingerprint: hash, aggregateMaximumCredits: 1, files: [] });
    const response = await POST(new Request("https://tavonel.com/api/uploads/approval", {
      method: "POST", headers: { "content-type": "application/json", "content-length": String(MAX_APPROVAL_METADATA_BYTES + 1) }, body,
    }));
    expect(response.status).toBe(415);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("refuses an over-bound streamed body even when Content-Length is absent", async () => {
    const validJson = JSON.stringify({ attemptKey, clientManifestDigest: hash, pricingFingerprint: hash, aggregateMaximumCredits: 1, files: [] });
    const response = await POST(new Request("https://tavonel.com/api/uploads/approval", {
      method: "POST", headers: { "content-type": "application/json" },
      body: `${validJson}${" ".repeat(MAX_APPROVAL_METADATA_BYTES)}`,
    }));
    expect(response.status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("fits 128 valid rows using maximum-length escaped filenames below the shared byte bound", async () => {
    const files = Array.from({ length: 128 }, (_, index) => ({
      fileKey: `fk_${String(index).padStart(8, "0")}${"x".repeat(116)}`,
      originalFilename: `${"\"".repeat(251)}.pdf`, contentSha256: hash,
      byteLength: 5_242_880, mimeType: "application/pdf", claimedPages: 80, claimedBasis: "pdf_page_tree",
    }));
    const body = JSON.stringify(await requestBody(files, 128));
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(MAX_APPROVAL_METADATA_BYTES);
    const response = await POST(new Request("https://tavonel.com/api/uploads/approval", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }));
    expect(response.status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0]![0].files).toHaveLength(128);
  });
});
