import { createHash } from "node:crypto";

export const RELEASE_MANIFEST_SCHEMA = "tavonel.release_manifest.v1" as const;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

export type ReleaseBinding = {
  digest: string | null;
  source: string;
};

export type ReleaseManifestInput = {
  generatedAt: string;
  site: { commit: string; sourceDigest: string; dirty: boolean };
  productCore: ReleaseBinding;
  images: { ocr: ReleaseBinding; cdr: ReleaseBinding };
  databaseSchema: ReleaseBinding;
  policyBundle: ReleaseBinding;
};

export type ReleaseManifest = ReleaseManifestInput & {
  schemaVersion: typeof RELEASE_MANIFEST_SCHEMA;
  status: "bindings_complete" | "incomplete";
  missing: string[];
  manifestDigest: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Text(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bindingMissing(name: string, binding: ReleaseBinding, missing: string[]) {
  if (!binding.digest || !DIGEST.test(binding.digest)) missing.push(name);
  if (!binding.source.trim()) missing.push(name.replace("digest", "source"));
}

export function buildReleaseManifest(input: ReleaseManifestInput): ReleaseManifest {
  const missing: string[] = [];
  if (!Number.isFinite(Date.parse(input.generatedAt)) || new Date(input.generatedAt).toISOString() !== input.generatedAt) {
    missing.push("generatedAt");
  }
  if (!COMMIT.test(input.site.commit)) missing.push("site.commit");
  if (!DIGEST.test(input.site.sourceDigest)) missing.push("site.sourceDigest");
  if (input.site.dirty) missing.push("site.cleanTree");
  bindingMissing("productCore.digest", input.productCore, missing);
  bindingMissing("images.ocr.digest", input.images.ocr, missing);
  bindingMissing("images.cdr.digest", input.images.cdr, missing);
  bindingMissing("databaseSchema.digest", input.databaseSchema, missing);
  bindingMissing("policyBundle.digest", input.policyBundle, missing);

  const unsigned = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA,
    status: missing.length === 0 ? "bindings_complete" as const : "incomplete" as const,
    missing: [...missing].sort(),
    ...input,
  };
  return { ...unsigned, manifestDigest: sha256Text(canonical(unsigned)) };
}

export function verifyReleaseManifestChecksum(manifest: ReleaseManifest) {
  const { manifestDigest, ...unsigned } = manifest;
  const rebuilt = buildReleaseManifest({
    generatedAt: manifest.generatedAt,
    site: manifest.site,
    productCore: manifest.productCore,
    images: manifest.images,
    databaseSchema: manifest.databaseSchema,
    policyBundle: manifest.policyBundle,
  });
  return manifest.schemaVersion === RELEASE_MANIFEST_SCHEMA
    && manifest.status === rebuilt.status
    && JSON.stringify(manifest.missing) === JSON.stringify(rebuilt.missing)
    && manifestDigest === sha256Text(canonical(unsigned));
}
