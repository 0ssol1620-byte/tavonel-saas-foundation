type SupabaseAdminConfig = { url: string; serviceRoleKey: string };

export function readSupabaseAdminConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseAdminConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return url.startsWith("https://") && serviceRoleKey.length >= 32 ? { url, serviceRoleKey } : null;
}

export async function supabaseAdminRequest(
  config: SupabaseAdminConfig,
  path: string,
  init: RequestInit = {},
) {
  return fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(4_000),
  });
}
