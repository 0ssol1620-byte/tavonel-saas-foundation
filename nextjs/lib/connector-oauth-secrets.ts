const SECRET_REFERENCE = /^(vercel|aws-sm|gcp-sm|azure-kv|vault):\/\/[A-Za-z0-9._/@:+-]{3,500}$/;

type SecretBrokerConfig = { url: string; authorization: string };

export function readOAuthSecretBrokerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretBrokerConfig | null {
  const url = env.TAVONEL_OAUTH_SECRET_BROKER_URL?.trim().replace(/\/$/, "") ?? "";
  const authorization = env.TAVONEL_OAUTH_SECRET_BROKER_TOKEN?.trim() ?? "";
  if (!url.startsWith("https://") || authorization.length < 32) return null;
  return { url, authorization };
}

async function brokerRequest(config: SecretBrokerConfig, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${config.url}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.authorization}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error("OAUTH_SECRET_BROKER_FAILED");
  return payload;
}

export async function putOAuthSecret(config: SecretBrokerConfig, name: string, value: string) {
  if (!/^[A-Za-z0-9._/-]{3,240}$/.test(name) || !value) throw new Error("OAUTH_SECRET_INPUT_INVALID");
  const payload = await brokerRequest(config, "/v1/secrets/write", { name, value });
  const reference = typeof payload.reference === "string" ? payload.reference : "";
  if (!SECRET_REFERENCE.test(reference)) throw new Error("OAUTH_SECRET_REFERENCE_INVALID");
  return reference;
}

export async function readOAuthSecret(config: SecretBrokerConfig, reference: string) {
  if (!SECRET_REFERENCE.test(reference)) throw new Error("OAUTH_SECRET_REFERENCE_INVALID");
  const payload = await brokerRequest(config, "/v1/secrets/read", { reference });
  const value = typeof payload.value === "string" ? payload.value : "";
  if (!value) throw new Error("OAUTH_SECRET_VALUE_MISSING");
  return value;
}

export async function deleteOAuthSecret(config: SecretBrokerConfig, reference: string) {
  if (!SECRET_REFERENCE.test(reference)) throw new Error("OAUTH_SECRET_REFERENCE_INVALID");
  await brokerRequest(config, "/v1/secrets/delete", { reference });
}
