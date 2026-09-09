import { expect, it } from "vitest";
import { quickXorHash } from "./quick-xor-hash";
it("matches independently evaluated bit-vector fixtures across the 160-byte wrap", () => {
  expect(quickXorHash(new Uint8Array())).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  expect(quickXorHash(new TextEncoder().encode("abc"))).toBe("YRDDGAAAAAAAAAAAAwAAAAAAAAA=");
  expect(quickXorHash(Uint8Array.from({ length: 256 }, (_, i) => i))).toBe("QkGEfSisZcA7k+FCh71r2dbCayY=");
});
