export const OAUTH_CONNECTOR_PROVIDERS = [
  "google_drive",
  "dropbox",
  "microsoft_graph",
] as const;

export type OAuthConnectorProvider = (typeof OAUTH_CONNECTOR_PROVIDERS)[number];

export type OAuthProviderRuntime = {
  provider: OAuthConnectorProvider;
  clientId: string;
  clientSecretReference: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: readonly string[];
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
};

export type OAuthProviderIdentity = {
  accountId: string;
  label: string | null;
};

const MANAGED_SECRET_REFERENCE = /^(vercel|aws-sm|gcp-sm|azure-kv|vault):\/\/[A-Za-z0-9._/@:+-]{3,500}$/;
const PROVIDER_ENV = {
  google_drive: "GOOGLE_DRIVE",
  dropbox: "DROPBOX",
  microsoft_graph: "MICROSOFT_GRAPH",
} as const;

const PROVIDER_CONTRACTS: Record<OAuthConnectorProvider, Omit<OAuthProviderRuntime, "clientId" | "clientSecretReference" | "redirectUri">> = {
  google_drive: {
    provider: "google_drive",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
  },
  dropbox: {
    provider: "dropbox",
    authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
  },
  microsoft_graph: {
    provider: "microsoft_graph",
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "profile", "offline_access", "User.Read", "Files.Read.All", "Sites.Read.All"],
  },
};

/*
  The scopes each provider is asked for, published rather than discovered at the consent screen.

  A buyer's security review asks this question before anyone clicks Allow, and the answer has to
  be the one the code sends. Derived from the contracts above so the page cannot state a
  narrower set than the authorization request actually carries.
*/
export const OAUTH_CONNECTOR_SCOPES = Object.fromEntries(
  Object.entries(PROVIDER_CONTRACTS).map(([provider, contract]) => [provider, contract.scopes]),
) as Record<OAuthConnectorProvider, readonly string[]>;

export function parseOAuthConnectorProvider(value: unknown): OAuthConnectorProvider | null {
  return typeof value === "string" && (OAUTH_CONNECTOR_PROVIDERS as readonly string[]).includes(value)
    ? value as OAuthConnectorProvider
    : null;
}

export function readOAuthProviderRuntime(
  provider: OAuthConnectorProvider,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OAuthProviderRuntime | null {
  const suffix = PROVIDER_ENV[provider];
  const clientId = env[`TAVONEL_OAUTH_${suffix}_CLIENT_ID`]?.trim() ?? "";
  const clientSecretReference = env[`TAVONEL_OAUTH_${suffix}_CLIENT_SECRET_REF`]?.trim() ?? "";
  const publicOrigin = env.TAVONEL_PUBLIC_ORIGIN?.trim().replace(/\/$/, "") ?? "";
  if (!clientId || clientId.length > 512 || !MANAGED_SECRET_REFERENCE.test(clientSecretReference)) return null;
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(publicOrigin)) return null;
  return {
    ...PROVIDER_CONTRACTS[provider],
    clientId,
    clientSecretReference,
    redirectUri: `${publicOrigin}/api/v1/oauth-connectors/callback/${provider}`,
  };
}

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

export function createOAuthPkce() {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  return { state, verifier };
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function buildOAuthAuthorizationUrl(runtime: OAuthProviderRuntime, state: string, verifier: string) {
  const url = new URL(runtime.authorizationEndpoint);
  url.searchParams.set("client_id", runtime.clientId);
  url.searchParams.set("redirect_uri", runtime.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", runtime.scopes.join(" "));
  if (runtime.provider === "google_drive") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (runtime.provider === "dropbox") url.searchParams.set("token_access_type", "offline");
  return url.toString();
}

export async function exchangeOAuthCode(input: {
  runtime: OAuthProviderRuntime;
  code: string;
  verifier: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}): Promise<OAuthTokenSet> {
  const fetcher = input.fetcher ?? fetch;
  const body = new URLSearchParams({
    client_id: input.runtime.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: "authorization_code",
    redirect_uri: input.runtime.redirectUri,
  });
  const response = await fetcher(input.runtime.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  if (!response.ok || !accessToken || !refreshToken) throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
  const grantedScopes = typeof payload.scope === "string"
    ? payload.scope.split(/[ ,]+/).filter(Boolean)
    : [...input.runtime.scopes];
  return { accessToken, refreshToken, grantedScopes };
}

export async function refreshOAuthAccessToken(input: {
  runtime: OAuthProviderRuntime;
  refreshToken: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}): Promise<OAuthTokenSet> {
  const fetcher = input.fetcher ?? fetch;
  const body = new URLSearchParams({
    client_id: input.runtime.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetcher(input.runtime.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) throw new Error("OAUTH_TOKEN_REFRESH_FAILED");
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : input.refreshToken,
    grantedScopes: typeof payload.scope === "string" ? payload.scope.split(/[ ,]+/).filter(Boolean) : [...input.runtime.scopes],
  };
}

export async function fetchOAuthProviderIdentity(
  provider: OAuthConnectorProvider,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<OAuthProviderIdentity> {
  let url: string;
  let init: RequestInit = { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } };
  if (provider === "google_drive") url = "https://www.googleapis.com/oauth2/v2/userinfo";
  else if (provider === "dropbox") {
    url = "https://api.dropboxapi.com/2/users/get_current_account";
    init = { ...init, method: "POST" };
  } else url = "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName";
  const response = await fetcher(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accountId = provider === "dropbox"
    ? String(payload.account_id ?? "")
    : String(payload.id ?? "");
  const label = provider === "google_drive"
    ? String(payload.email ?? payload.name ?? "")
    : provider === "dropbox"
      ? String(payload.email ?? payload.name ?? "")
      : String(payload.userPrincipalName ?? payload.displayName ?? "");
  if (!response.ok || !accountId || accountId.length > 512) throw new Error("OAUTH_IDENTITY_LOOKUP_FAILED");
  return { accountId, label: label ? label.slice(0, 512) : null };
}
