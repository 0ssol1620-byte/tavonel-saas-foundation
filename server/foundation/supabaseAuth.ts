export type SupabaseAuthConfiguration = {
  projectUrl?: string;
  anonKey?: string;
  redirectOrigin?: string;
};

export type AuthReadiness =
  | { ready: false; code: "AUTH_NOT_CONFIGURED" | "INVALID_REDIRECT_ORIGIN" }
  | { ready: true; code: "READY_FOR_SANDBOX"; redirectOrigin: string };

export function assessSupabaseAuthReadiness(
  configuration: SupabaseAuthConfiguration,
): AuthReadiness {
  if (!configuration.projectUrl || !configuration.anonKey || !configuration.redirectOrigin) {
    return { ready: false, code: "AUTH_NOT_CONFIGURED" };
  }

  try {
    const projectUrl = new URL(configuration.projectUrl);
    const redirectOrigin = new URL(configuration.redirectOrigin);
    if (projectUrl.protocol !== "https:" || redirectOrigin.protocol !== "https:") {
      return { ready: false, code: "INVALID_REDIRECT_ORIGIN" };
    }
    return { ready: true, code: "READY_FOR_SANDBOX", redirectOrigin: redirectOrigin.origin };
  } catch {
    return { ready: false, code: "INVALID_REDIRECT_ORIGIN" };
  }
}

export function getDefaultAuthReadiness(): AuthReadiness {
  return assessSupabaseAuthReadiness({
    projectUrl: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    redirectOrigin: process.env.SUPABASE_REDIRECT_ORIGIN,
  });
}
