export type CommercialMode = "pilot" | "live";

type Environment = Readonly<Record<string, string | undefined>>;

export function readCommercialMode(env: Environment = process.env): CommercialMode {
  return env.COMMERCIAL_MODE?.trim().toLowerCase() === "live" ? "live" : "pilot";
}

export function isLiveCommercialMode(env: Environment = process.env) {
  return readCommercialMode(env) === "live";
}
