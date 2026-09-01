import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmFoundationIntake, reserveFoundationIntake, validateIntakeAdmission } from "./intake-admission";

const admission = {
  workspaceKey: "pilot-4444444444444444",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "44444444-4444-4444-8444-444444444444",
  objectKey: "quarantine/pilot-4444444444444444/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source",
  requestedBytes: 1024,
  declaredMimeType: "application/pdf",
};

describe("Foundation intake admission", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts only an exact bounded tenant/document binding", () => {
    expect(validateIntakeAdmission(admission)).toBe(true);
    expect(validateIntakeAdmission({ ...admission, objectKey: `${admission.objectKey}/../source` })).toBe(false);
    expect(validateIntakeAdmission({ ...admission, requestedBytes: 5 * 1024 * 1024 + 1 })).toBe(false);
    expect(validateIntakeAdmission({ ...admission, userId: "not-a-user" })).toBe(false);
  });

  it("fails closed without server-only Supabase credentials", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(reserveFoundationIntake(admission)).resolves.toEqual({
      ok: false,
      code: "INTAKE_ADMISSION_NOT_CONFIGURED",
    });
  });

  it("accepts only a receipt bound to the requested document and object", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      documentId: admission.documentId,
      objectKey: admission.objectKey,
      expiresAt: "2026-08-29T12:00:00.000Z",
      idempotentReplay: false,
      confirmed: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await reserveFoundationIntake(admission);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual(expect.objectContaining({
      p_workspace_key: admission.workspaceKey,
      p_document_id: admission.documentId,
      p_user_id: admission.userId,
      p_object_key: admission.objectKey,
    }));
  });

  it("confirms only a receipt bound to the same tenant, document and user", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "confirmed",
      documentId: admission.documentId,
      confirmedAt: "2026-09-01T12:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(confirmFoundationIntake(admission)).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({ documentId: admission.documentId, status: "confirmed" }),
    });
  });

  it.each([
    ["foundation_intake_rate_limited", "INTAKE_RATE_LIMITED"],
    ["foundation_intake_daily_quota_exceeded", "INTAKE_DAILY_QUOTA_EXCEEDED"],
    ["foundation_intake_idempotency_conflict", "INTAKE_IDEMPOTENCY_CONFLICT"],
  ])("maps database guard %s without leaking service details", async (message, code) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));

    await expect(reserveFoundationIntake(admission)).resolves.toEqual({ ok: false, code });
  });
});
