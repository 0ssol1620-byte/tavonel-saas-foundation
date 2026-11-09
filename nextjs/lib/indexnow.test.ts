import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { HOST, payload, readKey, sitemapUrls } from "../scripts/indexnow-ping.mjs";

/*
  GX-04 (docs/policy/DECISION_LOG_2026-11-09.md): IndexNow. The key file is public by design and is
  what proves ownership, so the checks are that exactly one exists, that it holds its own key, that
  robots.txt withholds it from no crawler, and that the script submits only this host's URLs.
*/
describe("IndexNow", () => {
  const key: string = readKey();

  it("serves exactly one 32-hex key file whose body is the key", () => {
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(resolve(import.meta.dirname, `../public/${key}.txt`), "utf8").trim()).toBe(key);
  });

  it("is not withheld by robots.txt", () => {
    const rules = [robots().rules].flat();
    const path = `/${key}.txt`;
    for (const rule of rules.filter((candidate) => candidate.allow !== undefined)) {
      const disallow = [rule.disallow ?? []].flat();
      expect(disallow.some((prefix) => path.startsWith(prefix)), String(rule.userAgent)).toBe(false);
    }
  });

  it("submits this host's sitemap URLs once each, with the key location", () => {
    const xml = "<urlset><url><loc>https://tavonel.com/</loc></url><url><loc> https://tavonel.com/pricing </loc></url><url><loc>https://tavonel.com/</loc></url><url><loc>https://example.com/x</loc></url></urlset>";
    const urls = sitemapUrls(xml);
    expect(urls).toEqual(["https://tavonel.com/", "https://tavonel.com/pricing"]);
    expect(payload(urls, key)).toEqual({ host: HOST, key, keyLocation: `https://tavonel.com/${key}.txt`, urlList: urls });
  });

  it("refuses an empty submission rather than sending nothing as success", () => {
    expect(() => payload(sitemapUrls("<urlset></urlset>"), key)).toThrow(/no URL/);
  });
});
