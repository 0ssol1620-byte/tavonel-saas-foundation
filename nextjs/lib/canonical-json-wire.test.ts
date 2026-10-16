import { describe, expect, it } from "vitest";
import { canonicalJsonWireField } from "./canonical-json-wire";

describe("Core candidate wire hashing", () => {
  it("preserves Python numeric spelling while sorting nested keys and removing whitespace", () => {
    expect(canonicalJsonWireField('{"candidate": {"z": [1.0, 1e-07, -0.0], "a": {"b": true, "a": null}}}', "candidate"))
      .toBe('{"a":{"a":null,"b":true},"z":[1.0,1e-07,-0.0]}');
  });
  it("uses Python code-point ordering and preserves Korean and escaped string values", () => {
    expect(canonicalJsonWireField('{"candidate":{"😀":"한글\\n\\\"", "\\uE000":1}}', "candidate"))
      .toBe('{"":1,"😀":"한글\\n\\\""}');
  });
  it.each(['{"candidate":{"x":1,"x":2}}', '{"candidate":{},"candidate":{}}',
    '{"candidate":[1,]}', '{"candidate":{"x":01}}', '{"candidate":{"x":NaN}}',
    '{"candidate":"unterminated}', '{"candidate":{}} trailing', '[]', '{}'])
    ("refuses ambiguous or malformed JSON %s", raw => {
      expect(canonicalJsonWireField(raw, "candidate")).toBeNull();
    });
  it("bounds nesting before overflowing the parser stack", () => {
    expect(canonicalJsonWireField(`{"candidate":${"[".repeat(150)}0${"]".repeat(150)}}`, "candidate")).toBeNull();
  });
});
