import { describe, expect, it } from "vitest";
import { buildBgeM3BaselineProfile } from "./retrieval-profile";
import {
  contentAddressedRetrievalProfileIdentity,
  sameRetrievalProfileIdentity,
} from "./retrieval-profile-identity";

describe("content-addressed retrieval profile identity", () => {
  it("binds the logical profile id to the exact recipe digest", () => {
    const first = contentAddressedRetrievalProfileIdentity(
      buildBgeM3BaselineProfile("pilot-proof", "embed-r1", "rerank-r1"),
    );
    const same = contentAddressedRetrievalProfileIdentity(
      buildBgeM3BaselineProfile("pilot-proof", "embed-r1", "rerank-r1"),
    );
    const revised = contentAddressedRetrievalProfileIdentity(
      buildBgeM3BaselineProfile("pilot-proof", "embed-r2", "rerank-r1"),
    );

    expect(first).toEqual(same);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(sameRetrievalProfileIdentity(first, same)).toBe(true);
    expect(sameRetrievalProfileIdentity(first, revised)).toBe(false);
  });

  it("refuses a claimed digest that does not address the supplied recipe", () => {
    const profile = buildBgeM3BaselineProfile("pilot-proof", "embed-r1", "rerank-r1");
    expect(() => contentAddressedRetrievalProfileIdentity({
      ...profile,
      profileDigest: `sha256:${"0".repeat(64)}`,
    })).toThrow("RETRIEVAL_PROFILE_DIGEST_MISMATCH");
  });
});
