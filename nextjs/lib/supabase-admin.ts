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
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("content-type", "application/json");
  if (config.serviceRoleKey.startsWith("sb_secret_")) headers.delete("authorization");
  else headers.set("authorization", `Bearer ${config.serviceRoleKey}`);
  return fetch(`${config.url}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(4_000),
  });
}
