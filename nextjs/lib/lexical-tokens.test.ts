import { describe, expect, it } from "vitest";
import { expandedTokens, tokens } from "./lexical-tokens";

describe("tokens", () => {
  it("lowercases and splits on non-letter/number boundaries", () => {
    expect(tokens("Payment Terms: Net-30")).toEqual(["payment", "terms", "net", "30"]);
  });

  it("strips a trailing Korean particle when the remaining stem is at least 2 characters", () => {
    expect(tokens("삼성전자는")).toEqual(["삼성전자"]);
  });

  it("leaves a 2-character Korean token alone: too short to even attempt particle stripping", () => {
    expect(tokens("저는")).toEqual(["저는"]);
  });

  it("drops stop words in both English and Korean, but only words actually on the list", () => {
    expect(tokens("what is the revenue")).toEqual(["is", "revenue"]);
    expect(tokens("매출에 대한 정보")).toEqual(["매출", "정보"]);
  });
});

describe("expandedTokens", () => {
  it("expands a token to its full synonym group across languages", () => {
    const expanded = expandedTokens("매출");
    expect(expanded).toEqual(expect.arrayContaining(["revenue", "sales", "매출", "수익", "売上", "收入"]));
  });

  it("leaves a token with no synonym group unchanged", () => {
    expect(expandedTokens("acme")).toEqual(["acme"]);
  });
});
