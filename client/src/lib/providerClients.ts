import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ProviderEnvironment = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  paddleSandboxToken?: string;
};

function configuredEnvironment(): ProviderEnvironment {
  return {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    paddleSandboxToken: import.meta.env.VITE_PADDLE_SANDBOX_CLIENT_TOKEN,
  };
}

export function createSupabaseBrowserClient(
  environment = configuredEnvironment(),
): SupabaseClient | null {
  if (!environment.supabaseUrl || !environment.supabaseAnonKey) return null;
  try {
    const url = new URL(environment.supabaseUrl);
    if (url.protocol !== "https:") return null;
    return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    return null;
  }
}

export async function loadPaddleSandbox(
  environment = configuredEnvironment(),
): Promise<Paddle | null> {
  if (!environment.paddleSandboxToken) return null;
  return (await initializePaddle({
    environment: "sandbox",
    token: environment.paddleSandboxToken,
  })) ?? null;
}
