import { createHmac, timingSafeEqual } from "node:crypto";
import { CDR_IDENTITY_AUDIENCE } from "./cdr-workload-identity";

export const CDR_IDENTITY_PATH = "/api/internal/cdr/identity";

/** Domain-separated request signature; the endpoint accepts no user-selectable target. */
export function verifyCdrIdentityRequest(headers: Headers, secret: string | undefined, now = Date.now()): string | null {
  const id = headers.get("x-tavonel-identity-request-id") ?? "";
  const timestamp = headers.get("x-tavonel-identity-timestamp") ?? "";
  const signature = headers.get("x-tavonel-identity-signature") ?? "";
  const time = Date.parse(timestamp);
  if (!secret || secret.trim().length < 32 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
    || !Number.isFinite(time) || Math.abs(now - time) > 60_000 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = createHmac("sha256", secret).update(
    `tavonel.cdr.identity.v1\nPOST\n${CDR_IDENTITY_PATH}\n${CDR_IDENTITY_AUDIENCE}\n${timestamp}\n${id}`,
  ).digest("base64url");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? id : null;
}
