import { describe, expect, it } from "vitest";
import { decisionProblem } from "../components/change-proposals-panel";

describe("proposal decision outcome message", () => {
  it("never says 'not saved' when the server may have changed the World (5xx, lost response)", () => {
    for (const status of [0, 500, 502, 503, 504]) {
      const message = decisionProblem(status);
      expect(message).toContain("could not be confirmed");
      expect(message).not.toContain("not saved");
    }
  });
  it("says 'not saved' only for a refusal made before any change", () => {
    expect(decisionProblem(400)).toBe("The decision was not saved. Try again.");
    expect(decisionProblem(404)).toBe("The decision was not saved. Try again.");
    expect(decisionProblem(403)).toBe("You can not decide on this proposal.");
    expect(decisionProblem(409)).toContain("can no longer be changed");
  });
  it("reports nothing on success", () => {
    expect(decisionProblem(200)).toBeNull();
  });
});
