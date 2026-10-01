import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Windows checkouts may carry CRLF (autocrlf); the repository stores LF.
const workflow = readFileSync("../.github/workflows/db-rehearsal.yml", "utf8").replace(/\r\n/g, "\n");
const RESERVE = 'sudo sysctl -w net.ipv4.ip_local_reserved_ports="${before:+$before,}54320-54329"';

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("db-rehearsal local stack port reservation", () => {
  it.each([
    ["db-rehearsal", "supabase db start"],
    ["real-auth-journey", "supabase start"],
  ])("%s reserves the stack ports before any network activity and before the stack binds", (name, command) => {
    const body = job(name);
    // The command line itself, not a mention of it in a comment.
    const start = `\n          ${command}\n`;
    expect(body).toContain(start);
    const reserve = body.indexOf(RESERVE);
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(body.indexOf("actions/checkout@v4"));
    expect(reserve).toBeLessThan(body.indexOf("supabase/setup-cli@v1"));
    expect(reserve).toBeLessThan(body.indexOf(start));
    // Only on a disposable GitHub-hosted runner, and only after reading what is already reserved.
    expect(body.indexOf('test "$RUNNER_ENVIRONMENT" = "github-hosted"')).toBeLessThan(reserve);
    expect(body.indexOf('before="$(cat "$key")"')).toBeLessThan(reserve);
    // Every new port and every previously reserved entry must still be covered afterwards.
    expect(body).toContain('for port in $(seq 54320 54329) $(echo "$before" | tr \',-\' \'  \'); do covered "$port"; done');
    // The holder of a stack port, if any, is recorded right before the bind.
    const evidence = body.lastIndexOf("ss -Htanp '( sport >= :54320 and sport <= :54329 )' || true", body.indexOf(start));
    expect(evidence).toBeGreaterThan(reserve);
  });

  it("never overwrites the reservation, and never stops or kills anything to free a port", () => {
    expect(workflow).not.toMatch(/ip_local_reserved_ports=54320-54329/);
    expect(workflow).not.toMatch(/\b(kill|pkill|fuser|systemctl stop|docker (rm|stop|kill))\b/);
  });

  it("keeps the CLI default ports that the real-Auth contract accepts", () => {
    const contract = readFileSync("scripts/journey/real-auth-ci-contract.mjs", "utf8");
    expect(contract).toContain('"http://127.0.0.1:54321"');
    expect(contract).toContain('database.port, "54322"');
    expect(workflow).not.toMatch(/^\s*port\s*=/m);
  });
});
