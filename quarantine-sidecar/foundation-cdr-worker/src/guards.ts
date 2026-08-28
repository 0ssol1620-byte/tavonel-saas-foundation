import { PermanentReject } from "./errors";
import { hmacSecretIsConfigured } from "./hmac";

export const SYNTHETIC_CDR_HOST_MARKER = "tavonel-cdr-synthetic";
export const PROD_CDR_HOST_MARKER = "tavonel-pdf-cdr";
export const PROD_QUARANTINE_BUCKET = "tavonel-prod-quarantine";
export const FOUNDATION_QUARANTINE_BUCKET = "tavonel-saas-foundation-quarantine";
export const SYNTHETIC_PROVIDER = "tavonel_pdf_raster";

export type HealthEnv = {
  TAVONEL_CDR_HMAC?: string;
  TAVONEL_CDR_URL: string;
  TAVONEL_CDR_HEALTH_URL: string;
  TAVONEL_CDR_PROVIDER: string;
  FOUNDATION_R2_BUCKET: string;
};

export function cdrUrlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isProdCdrUrl(url: string): boolean {
  return cdrUrlHost(url).includes(PROD_CDR_HOST_MARKER);
}

export function looksLikeSyntheticCdr(url: string, provider: string): boolean {
  const host = cdrUrlHost(url);
  return (
    host.includes(SYNTHETIC_CDR_HOST_MARKER) &&
    !host.includes(PROD_CDR_HOST_MARKER) &&
    (provider || "").trim() === SYNTHETIC_PROVIDER
  );
}

export function isProdQuarantineBucket(bucketName: string): boolean {
  return (bucketName || "").trim() === PROD_QUARANTINE_BUCKET;
}

export function assertFoundationOnlyTarget(url: string, bucketName: string): void {
  if (isProdCdrUrl(url)) {
    throw new PermanentReject("production CDR URL is refused");
  }
  if (isProdQuarantineBucket(bucketName)) {
    throw new PermanentReject("production quarantine bucket is refused");
  }
}

export async function evaluateHealth(
  env: HealthEnv,
  fetcher: typeof fetch,
): Promise<{ httpStatus: number; body: Record<string, string | boolean> }> {
  if (!hmacSecretIsConfigured(env.TAVONEL_CDR_HMAC)) {
    return { httpStatus: 503, body: { status: "unavailable", reason: "CDR HMAC is not configured" } };
  }
  if (isProdCdrUrl(env.TAVONEL_CDR_URL) || isProdCdrUrl(env.TAVONEL_CDR_HEALTH_URL)) {
    return { httpStatus: 503, body: { status: "unavailable", reason: "production CDR URL is refused" } };
  }
  if (isProdQuarantineBucket(env.FOUNDATION_R2_BUCKET)) {
    return { httpStatus: 503, body: { status: "unavailable", reason: "production quarantine bucket is refused" } };
  }
  if (!looksLikeSyntheticCdr(env.TAVONEL_CDR_URL, env.TAVONEL_CDR_PROVIDER)) {
    return {
      httpStatus: 503,
      body: { status: "unavailable", reason: "CDR target is not the Foundation synthetic service" },
    };
  }
  if (env.FOUNDATION_R2_BUCKET !== FOUNDATION_QUARANTINE_BUCKET) {
    return {
      httpStatus: 503,
      body: { status: "unavailable", reason: "bound bucket is not the Foundation quarantine bucket" },
    };
  }
  try {
    const response = await fetcher(env.TAVONEL_CDR_HEALTH_URL, { method: "GET" });
    if (!response.ok) {
      return { httpStatus: 503, body: { status: "unavailable", reason: "synthetic CDR health check failed" } };
    }
  } catch {
    return { httpStatus: 503, body: { status: "unavailable", reason: "synthetic CDR health check failed" } };
  }
  return {
    httpStatus: 200,
    body: {
      status: "ok",
      provider: env.TAVONEL_CDR_PROVIDER,
      hmacConfigured: true,
    },
  };
}