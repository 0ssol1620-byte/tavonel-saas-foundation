import { createHmac } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type ContactAdmission = "allowed" | "limited" | "unavailable";

/** Stable, domain-separated opaque buckets; neither IP nor email/domain is persisted. */
export async function consumeDurableContactLimit(request: Request, email: string): Promise<ContactAdmission> {
  const config = readSupabaseAdminConfig();
  if (!config) return "unavailable";
  // Keep the deployment's existing trusted-proxy convention. Edge/WAF qualification
  // must separately prove which forwarding headers the platform overwrites.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip") || "unknown";
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (ip.length > 256 || !domain || domain.length > 253) return "unavailable";
  const key = (dimension: string, value: string) => createHmac("sha256", config.serviceRoleKey)
    .update(`tavonel-contact-v1:${dimension}\n${value}`).digest("hex");
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/consume_foundation_contact_limits", {
      method: "POST", body: JSON.stringify({ p_ip_key: key("ip", ip), p_domain_key: key("domain", domain) }),
    });
    if (!response.ok) return "unavailable";
    const result: unknown = await response.json();
    if (result === true) return "allowed";
    if (result === false) return "limited";
    return "unavailable";
  } catch { return "unavailable"; }
}
