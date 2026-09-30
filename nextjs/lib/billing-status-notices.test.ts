import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), member: vi.fn(), billing: vi.fn(), effective: vi.fn(), notices: vi.fn() }));
vi.mock("./foundation-pilot", () => ({ getRequestUser: mocks.user, foundationPilotAccess: mocks.access }));
vi.mock("./workspace-membership", () => ({ getWorkspaceMembership: mocks.member }));
vi.mock("./billing-store", () => ({ getFoundationBillingAccount: mocks.billing }));
vi.mock("./self-service-trial", () => ({ authorizeFoundationSessionProduct: mocks.effective }));
vi.mock("./billing-gate-enforcement", () => ({ listBillingNotices: mocks.notices }));
import { GET } from "../app/api/billing/status/route";

describe("billing status notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "owner-id" });
    mocks.access.mockReturnValue({ membership: { workspaceId: "pilot-owner" } });
    mocks.member.mockResolvedValue({ ok: true, membership: { state: "active" } });
    mocks.billing.mockResolvedValue({ ok: true, account: { subscriptionStatus: "paused" } });
    mocks.effective.mockResolvedValue({ ok: false });
    mocks.notices.mockResolvedValue([{ id: "notice-1", kind: "subscription_paused_processing_gate", refundReviewRequired: true }]);
  });
  it("lets an active owner see the pause notice even after paid access ends", async () => {
    const response = await GET(new Request("https://tavonel.com/api/billing/status"));
    expect(response.status).toBe(200);
    expect((await response.json()).notices[0].refundReviewRequired).toBe(true);
    expect(mocks.notices).toHaveBeenCalledWith("pilot-owner", "owner-id");
  });
  it("does not read notices for revoked membership", async () => {
    mocks.member.mockResolvedValue({ ok: true, membership: { state: "revoked" } });
    expect((await GET(new Request("https://tavonel.com/api/billing/status"))).status).toBe(403);
    expect(mocks.notices).not.toHaveBeenCalled();
  });
  it("distinguishes an unavailable notice store from no notices", async () => {
    mocks.notices.mockResolvedValue(null);
    const body = await (await GET(new Request("https://tavonel.com/api/billing/status"))).json();
    expect(body.notices).toBeNull();
    expect(body.account.subscriptionStatus).toBe("paused");
  });
});
