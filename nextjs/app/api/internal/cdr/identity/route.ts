import { getVercelOidcToken } from "@vercel/functions/oidc";
import { handleCdrIdentity } from "@/lib/cdr-identity-handler";
import { cdrIdentityToken } from "@/lib/cdr-workload-identity";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleCdrIdentity(request, {
    env: process.env,
    claim: async id => {
      const config = readSupabaseAdminConfig();
      if (!config) throw new Error("CDR_IDENTITY_UNAVAILABLE");
      const response = await supabaseAdminRequest(config, "/rest/v1/rpc/claim_cdr_identity_request", {
        method: "POST", body: JSON.stringify({ p_request_id: id }),
      });
      if (!response.ok) throw new Error("CDR_IDENTITY_UNAVAILABLE");
      const claimed: unknown = await response.json();
      if (typeof claimed !== "boolean") throw new Error("CDR_IDENTITY_UNAVAILABLE");
      return claimed;
    },
    subject: getVercelOidcToken,
    mint: cdrIdentityToken,
  });
}
