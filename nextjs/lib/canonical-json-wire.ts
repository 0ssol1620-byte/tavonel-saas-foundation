/**
 * Canonicalize a JSON response field without discarding its numeric wire spelling.
 *
 * Core hashes Python JSON: a float 1.0 stays 1.0. JSON.parse followed by stringify
 * changes it to 1, so it cannot verify those bytes. Parse structure and strings,
 * preserve number tokens, sort keys by Unicode code point (Python's ordering),
 * and reject duplicate keys. This verifies the digest of the actual field rather
 * than accepting an alternative digest for a parsed approximation.
 */
export function canonicalJsonWireField(raw: string, field: string): string | null {
  let offset = 0;
  let entries = 0;
  let selected: string | null = null;
  const whitespace = () => { while (/[ \t\r\n]/.test(raw[offset] ?? "") && offset < raw.length) offset++; };
  function stringToken() {
    const start = offset++;
    while (offset < raw.length) {
      const character = raw[offset++]!;
      if (character === "\\") offset++;
      else if (character === '"') {
        const value: unknown = JSON.parse(raw.slice(start, offset));
        if (typeof value !== "string") throw new Error("string required");
        return value;
      }
    }
    throw new Error("unterminated string");
  }
  const compareKeys = (left: string, right: string) => {
    const a = Array.from(left, character => character.codePointAt(0)!);
    const b = Array.from(right, character => character.codePointAt(0)!);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  };
  function value(depth: number): string {
    if (depth > 128 || ++entries > 2_000_000) throw new Error("JSON complexity exceeded");
    whitespace();
    const character = raw[offset];
    if (character === '"') return JSON.stringify(stringToken());
    if (character === "{") {
      offset++; whitespace();
      const fields = new Map<string, string>();
      if (raw[offset] !== "}") while (true) {
        whitespace();
        if (raw[offset] !== '"') throw new Error("object key required");
        const key = stringToken(); whitespace();
        if (fields.has(key) || raw[offset++] !== ":") throw new Error("duplicate key or missing colon");
        const item = value(depth + 1);
        fields.set(key, item);
        if (depth === 0 && key === field) selected = item;
        whitespace();
        if (raw[offset] !== ",") break;
        offset++;
      }
      if (raw[offset++] !== "}") throw new Error("object end required");
      return `{${[...fields].sort(([a], [b]) => compareKeys(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${item}`).join(",")}}`;
    }
    if (character === "[") {
      offset++; whitespace();
      const values: string[] = [];
      if (raw[offset] !== "]") while (true) {
        values.push(value(depth + 1)); whitespace();
        if (raw[offset] !== ",") break;
        offset++;
      }
      if (raw[offset++] !== "]") throw new Error("array end required");
      return `[${values.join(",")}]`;
    }
    const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(offset))?.[0];
    if (!token) throw new Error("JSON value required");
    offset += token.length;
    return token;
  }
  try {
    whitespace();
    if (raw[offset] !== "{") return null;
    value(0); whitespace();
    return offset === raw.length ? selected : null;
  } catch { return null; }
}
