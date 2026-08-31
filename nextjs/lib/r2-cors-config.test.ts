import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type CorsRule = {
  allowed: {
    origins: string[];
    methods: string[];
    headers: string[];
  };
};

const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../docs/r2-foundation-cors.json"), "utf8").replace(
    /^\uFEFF/,
    "",
  ),
) as { rules: CorsRule[] };

describe("R2 Foundation CORS", () => {
  it("allows canonical production origins to upload without broadening access", () => {
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].allowed.origins).toEqual(
      expect.arrayContaining(["https://tavonel.com", "https://www.tavonel.com"]),
    );
    expect(config.rules[0].allowed.origins).not.toContain("*");
    expect(config.rules[0].allowed.methods).toContain("PUT");
    expect(config.rules[0].allowed.headers).toEqual([
      "Content-Type",
      "Content-Length",
      "Content-MD5",
    ]);
  });
});
